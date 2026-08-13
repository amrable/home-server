import json
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import urllib.error
import urllib.request

DATA_DIR = Path('/app/data')
DB_PATH = DATA_DIR / 'receipts.db'
INDEX_HTML = Path('/app/index.html')
N8N_WEBHOOK = 'http://n8n-app:5678/webhook/parse-receipt'
MAX_BODY = 20 * 1024 * 1024


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
            r = urllib.request.Request(
                N8N_WEBHOOK,
                data=json.dumps(req).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(r, timeout=120) as resp:
                result = json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:500]
            conn.close()
            self.send_json(json.dumps({'error': 'n8n failed', 'status': e.code, 'detail': detail}).encode('utf-8'), 502)
            return
        except Exception as e:
            conn.close()
            self.send_json(json.dumps({'error': 'n8n unreachable', 'detail': str(e)}).encode('utf-8'), 502)
            return

        parsed = result.get('parsed', result)
        conn.execute(
            'INSERT INTO receipts (filename, result, mime_type) VALUES (?, ?, ?)',
            (filename, json.dumps(parsed), req.get('mimeType', '')),
        )
        conn.commit()
        conn.close()
        self.send_json(json.dumps({'cached': False, 'parsed': parsed}).encode('utf-8'))

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
    ThreadingHTTPServer(('0.0.0.0', 80), Handler).serve_forever()