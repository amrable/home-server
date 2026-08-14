import json
import os
import re
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import urllib.error
import urllib.request

DATA_DIR = Path('/app/data')
DB_PATH = DATA_DIR / 'receipts.db'
INDEX_HTML = Path('/app/index.html')
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
MAX_BODY = 20 * 1024 * 1024

PROMPT = """Extract the receipt data as strict JSON (no markdown, no extra text). Use this schema:
{
  "vendor": string,
  "invoice_number": string,
  "invoice_date": "YYYY-MM-DD",
  "currency": string,
  "items": [ { "name": string, "quantity": number, "unit_price": number, "total": number } ],
  "subtotal": number,
  "tax": [ { "rate_percent": number, "amount": number } ],
  "total": number
}
Rules: "items" is a line-by-line breakdown of every purchased item. Include every VAT rate as a separate tax entry. Never guess - use null when a field cannot be determined."""


def parse_with_gemini(req):
    if not GEMINI_API_KEY:
        raise RuntimeError('GEMINI_API_KEY is not set')
    body = {
        'contents': [{
            'role': 'user',
            'parts': [
                {'text': PROMPT},
                {'inline_data': {
                    'mime_type': req.get('mimeType') or 'application/pdf',
                    'data': req.get('data'),
                }},
            ],
        }],
        'generationConfig': {'response_mime_type': 'application/json'},
    }
    r = urllib.request.Request(
        GEMINI_URL,
        data=json.dumps(body).encode('utf-8'),
        headers={'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(r, timeout=120) as resp:
        res = json.loads(resp.read().decode('utf-8'))
    raw = res['candidates'][0]['content']['parts'][0]['text'].strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw).strip()
    return json.loads(raw)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        'CREATE TABLE IF NOT EXISTS receipts ('
        'id INTEGER PRIMARY KEY AUTOINCREMENT, '
        'filename TEXT, '
        'result TEXT NOT NULL, '
        'mime_type TEXT, '
        'created_at TEXT DEFAULT CURRENT_TIMESTAMP)'
    )
    row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='receipts'").fetchone()
    if row and 'filename TEXT PRIMARY KEY' in row[0]:
        conn.execute(
            'CREATE TABLE receipts_new ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT, '
            'filename TEXT, '
            'result TEXT NOT NULL, '
            'mime_type TEXT, '
            'created_at TEXT DEFAULT CURRENT_TIMESTAMP)'
        )
        conn.execute(
            'INSERT INTO receipts_new (filename, result, mime_type, created_at) '
            'SELECT filename, result, mime_type, created_at FROM receipts'
        )
        conn.execute('DROP TABLE receipts')
        conn.execute('ALTER TABLE receipts_new RENAME TO receipts')
        conn.commit()
    return conn


def compute_summary():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute('SELECT result FROM receipts').fetchall()
    conn.close()

    totals = {}
    vendors = {}
    months = {}
    count = 0
    for (res,) in rows:
        try:
            p = json.loads(res)
        except ValueError:
            continue
        amount = p.get('total')
        if amount is None:
            continue
        count += 1
        currency = p.get('currency') or 'EUR'
        totals[currency] = totals.get(currency, 0) + amount

        vendor = p.get('vendor')
        if vendor:
            v = vendors.setdefault(vendor, {'count': 0, 'total': {}})
            v['count'] += 1
            v['total'][currency] = v['total'].get(currency, 0) + amount

        date = p.get('invoice_date')
        if date and len(date) >= 7:
            month = date[:7]
            months[month] = months.get(month, 0) + amount

    return {'count': count, 'total': totals, 'by_vendor': vendors, 'by_month': months}


def store_summary():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        'CREATE TABLE IF NOT EXISTS summary ('
        'key TEXT PRIMARY KEY, '
        'value TEXT NOT NULL, '
        'updated_at TEXT DEFAULT CURRENT_TIMESTAMP)'
    )
    conn.execute(
        'INSERT INTO summary (key, value) VALUES (?, ?) '
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP',
        ('user', json.dumps(compute_summary())),
    )
    conn.commit()
    conn.close()


class Handler(BaseHTTPRequestHandler):

    def do_GET(self):
        if self.path == '/':
            html = INDEX_HTML.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(html)))
            self.end_headers()
            self.wfile.write(html)
        elif self.path == '/api/receipts':
            conn = get_db()
            rows = conn.execute(
                'SELECT filename, mime_type, created_at, result FROM receipts ORDER BY created_at DESC'
            ).fetchall()
            conn.close()
            payload = json.dumps([
                {'filename': r[0], 'mimeType': r[1], 'createdAt': r[2], 'parsed': json.loads(r[3])}
                for r in rows
            ]).encode('utf-8')
            self.send_json(payload)
        elif self.path == '/api/summary':
            conn = get_db()
            row = conn.execute('SELECT value, updated_at FROM summary WHERE key = ?', ('user',)).fetchone()
            conn.close()
            if row:
                payload = json.dumps({'summary': json.loads(row[0]), 'updatedAt': row[1]}).encode('utf-8')
            else:
                payload = json.dumps({'summary': {'count': 0, 'total': {}, 'by_vendor': {}, 'by_month': {}}, 'updatedAt': None}).encode('utf-8')
            self.send_json(payload)
        else:
            self.send_json(json.dumps({'error': 'not found'}).encode('utf-8'), 404)

    def do_POST(self):
        if self.path != '/api/parse':
            self.send_json(json.dumps({'error': 'not found'}).encode('utf-8'), 404)
            return

        length = int(self.headers.get('Content-Length', 0))
        if length < 1 or length > MAX_BODY:
            self.send_json(json.dumps({'error': 'empty or oversized body'}).encode('utf-8'), 400)
            return

        try:
            req = json.loads(self.rfile.read(length).decode('utf-8'))
        except ValueError:
            self.send_json(json.dumps({'error': 'invalid JSON'}).encode('utf-8'), 400)
            return

        filename = req.get('filename')
        data = req.get('data')
        if not filename or not data:
            self.send_json(json.dumps({'error': 'filename and data are required'}).encode('utf-8'), 400)
            return

        conn = get_db()

        try:
            parsed = parse_with_gemini(req)
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:500]
            conn.close()
            self.send_json(json.dumps({'error': 'gemini failed', 'status': e.code, 'detail': detail}).encode('utf-8'), 502)
            return
        except Exception as e:
            conn.close()
            self.send_json(json.dumps({'error': 'parse failed', 'detail': str(e)}).encode('utf-8'), 502)
            return

        conn.execute(
            'INSERT INTO receipts (filename, result, mime_type) VALUES (?, ?, ?)',
            (filename, json.dumps(parsed), req.get('mimeType', '')),
        )
        conn.commit()
        conn.close()
        threading.Thread(target=store_summary, daemon=True).start()
        self.send_json(json.dumps({'parsed': parsed}).encode('utf-8'))

    def send_json(self, payload, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print('receipt-upload backend listening on :80')
    threading.Thread(target=store_summary, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', 80), Handler).serve_forever()