import json
import os
import re
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import urllib.error
import urllib.request

DATA_DIR = Path(os.environ.get('DATA_DIR', '/app/data'))
DB_PATH = DATA_DIR / 'receipts.db'
INDEX_HTML = Path(os.environ.get('INDEX_HTML', '/app/index.html'))
PORT = int(os.environ.get('PORT', '80'))
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '') or os.environ.get('GOOGLE_API_KEY', '')
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent'
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY', '')
OPENROUTER_MODEL = os.environ.get('OPENROUTER_MODEL', 'google/gemini-2.5-flash')
OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
LLM_PROVIDER = os.environ.get('LLM_PROVIDER', 'google').lower()
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


MERCHANTS_PATH = Path(os.environ.get('MERCHANTS_PATH', str(Path(__file__).resolve().parent / 'merchants.json')))
MERCHANTS = []
if MERCHANTS_PATH.exists():
    MERCHANTS = json.loads(MERCHANTS_PATH.read_text('utf-8')).get('merchants', [])


def match_merchant(vendor):
    if not vendor:
        return 'other'
    v = vendor.lower()
    for m in MERCHANTS:
        for alias in m.get('aliases', []):
            if alias in v:
                return m['key']
    return 'other'


def merchant_for(vendor, stored):
    if stored and stored != 'other':
        return stored
    return match_merchant(vendor)


def _extract_json_text(raw):
    raw = raw.strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw).strip()
    return raw


def _parse_json_response(raw):
    raw = _extract_json_text(raw)
    try:
        return json.loads(raw)
    except ValueError:
        pass
    m = re.search(r'\{.*\}', raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except ValueError:
            pass
    raise RuntimeError('could not parse model JSON: %s' % raw[:200])


def parse_with_google(req):
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
        GEMINI_URL % GEMINI_MODEL,
        data=json.dumps(body).encode('utf-8'),
        headers={'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(r, timeout=120) as resp:
        res = json.loads(resp.read().decode('utf-8'))
    raw = res['candidates'][0]['content']['parts'][0]['text']
    return _parse_json_response(raw)


def parse_with_openrouter(req):
    if not OPENROUTER_API_KEY:
        raise RuntimeError('OPENROUTER_API_KEY is not set')
    mime = req.get('mimeType') or 'application/pdf'
    data_url = 'data:%s;base64,%s' % (mime, req.get('data'))
    body = {
        'model': OPENROUTER_MODEL,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'text', 'text': PROMPT},
                {'type': 'image_url', 'image_url': {'url': data_url}},
            ],
        }],
        'response_format': {'type': 'json_object'},
    }
    r = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(body).encode('utf-8'),
        headers={'Authorization': 'Bearer %s' % OPENROUTER_API_KEY, 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(r, timeout=180) as resp:
        res = json.loads(resp.read().decode('utf-8'))
    content = res['choices'][0]['message']['content']
    return _parse_json_response(content)


def parse_with_provider(req):
    if LLM_PROVIDER == 'openrouter':
        return parse_with_openrouter(req)
    return parse_with_google(req)


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
    cols = [r[1] for r in conn.execute('PRAGMA table_info(receipts)').fetchall()]
    if 'merchant' not in cols:
        conn.execute("ALTER TABLE receipts ADD COLUMN merchant TEXT DEFAULT 'other'")
        conn.commit()
    return conn


CURRENCY_ALIASES = {
    '€': 'EUR', 'euro': 'EUR', 'euros': 'EUR', 'eur': 'EUR',
    '$': 'USD', 'usd': 'USD', 'usdollars': 'USD', 'dollars': 'USD', 'us dollar': 'USD',
    '£': 'GBP', 'gbp': 'GBP', 'pound': 'GBP', 'pounds': 'GBP', 'sterling': 'GBP',
    '¥': 'JPY', 'jpy': 'JPY', 'yen': 'JPY',
    'chf': 'CHF', 'franc': 'CHF', 'francs': 'CHF',
    'sek': 'SEK', 'krona': 'SEK', 'kr': 'SEK',
    'nok': 'NOK', 'dkk': 'DKK', 'czk': 'CZK',
    'zł': 'PLN', 'zl': 'PLN', 'pln': 'PLN', 'zloty': 'PLN',
    'ron': 'RON', 'lei': 'RON', 'huf': 'HUF', 'ft': 'HUF', 'forint': 'HUF',
    '₺': 'TRY', 'try': 'TRY', 'lira': 'TRY', 'aed': 'AED',
}


def norm_currency(c):
    if not c:
        return 'EUR'
    c = str(c).strip()
    low = c.lower()
    if low in CURRENCY_ALIASES:
        return CURRENCY_ALIASES[low]
    if re.fullmatch(r'[a-zA-Z]{3}', c):
        return c.upper()
    return c


def compute_summary():
    conn = get_db()
    rows = conn.execute('SELECT result, merchant FROM receipts').fetchall()
    conn.close()

    totals = {}
    vendors = {}
    merchants = {}
    months = {}
    count = 0
    for res, merchant in rows:
        try:
            p = json.loads(res)
        except ValueError:
            continue
        amount = p.get('total')
        if amount is None:
            continue
        count += 1
        currency = norm_currency(p.get('currency'))
        totals[currency] = totals.get(currency, 0) + amount

        vendor = p.get('vendor')
        if vendor:
            v = vendors.setdefault(vendor, {'count': 0, 'total': {}})
            v['count'] += 1
            v['total'][currency] = v['total'].get(currency, 0) + amount

        key = merchant_for(vendor, merchant)
        m = merchants.setdefault(key, {'count': 0, 'total': {}})
        m['count'] += 1
        m['total'][currency] = m['total'].get(currency, 0) + amount

        date = p.get('invoice_date')
        if date and len(date) >= 7:
            month = date[:7]
            months[month] = months.get(month, 0) + amount

    return {'count': count, 'total': totals, 'by_vendor': vendors, 'by_merchant': merchants, 'by_month': months}


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
                'SELECT id, filename, mime_type, created_at, result, merchant FROM receipts ORDER BY id DESC'
            ).fetchall()
            conn.close()
            payload = json.dumps([
                {
                    'id': r[0], 'filename': r[1], 'mimeType': r[2], 'createdAt': r[3],
                    'parsed': json.loads(r[4]),
                    'merchant': merchant_for(json.loads(r[4]).get('vendor'), r[5]),
                }
                for r in rows
            ]).encode('utf-8')
            self.send_json(payload)
        elif self.path == '/api/merchants':
            self.send_json(json.dumps({'merchants': MERCHANTS}).encode('utf-8'))
        elif self.path == '/api/summary':
            s = compute_summary()
            conn = get_db()
            row = conn.execute('SELECT updated_at FROM summary WHERE key = ?', ('user',)).fetchone()
            conn.close()
            payload = json.dumps({'summary': s, 'updatedAt': row[0] if row else None}).encode('utf-8')
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
            parsed = parse_with_provider(req)
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:500]
            conn.close()
            self.send_json(json.dumps({'error': 'llm failed', 'status': e.code, 'detail': detail}).encode('utf-8'), 502)
            return
        except Exception as e:
            conn.close()
            self.send_json(json.dumps({'error': 'parse failed', 'detail': str(e)}).encode('utf-8'), 502)
            return

        cur = conn.execute(
            'INSERT INTO receipts (filename, result, mime_type, merchant) VALUES (?, ?, ?, ?)',
            (filename, json.dumps(parsed), req.get('mimeType', ''), match_merchant(parsed.get('vendor'))),
        )
        new_id = cur.lastrowid
        conn.commit()
        conn.close()
        threading.Thread(target=store_summary, daemon=True).start()
        self.send_json(json.dumps({'parsed': parsed, 'merchant': match_merchant(parsed.get('vendor')), 'id': new_id}).encode('utf-8'))

    def do_DELETE(self):
        m = re.match(r'^/api/receipts/(\d+)$', self.path)
        if not m:
            self.send_json(json.dumps({'error': 'not found'}).encode('utf-8'), 404)
            return
        rid = int(m.group(1))
        conn = get_db()
        cur = conn.execute('DELETE FROM receipts WHERE id = ?', (rid,))
        conn.commit()
        conn.close()
        if cur.rowcount == 0:
            self.send_json(json.dumps({'error': 'not found'}).encode('utf-8'), 404)
            return
        threading.Thread(target=store_summary, daemon=True).start()
        self.send_json(b'{}')

    def send_json(self, payload, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    get_db()
    print(f'receipt-upload backend listening on :{PORT}')
    threading.Thread(target=store_summary, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()