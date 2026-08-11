# n8n service

Workflow automation, reachable at `https://n8n.<tailnet-domain>` via its Tailscale sidecar.

## Paperless — Trigger + Action setup (one-time, Paperless web UI)

Create a Workflow in Paperless (Workflows → Add) with **two** parts:

### Trigger
| Setting | Value |
|---|---|
| Type | **Document added** |
| (optional) Filter | Only documents matching a tag, e.g. invoice tag, to avoid running on every document |

### Action: Webhook
| Setting | Value |
|---|---|
| Type | **Webhook** |
| URL | `http://n8n-app:5678/webhook/paperless` |
| Encoding | JSON |
| Body | `{"id": {{ id }}, "doc_url": "{{ doc_url }}", "title": "{{ title }}"}` |

Only placeholders listed in the [workflow docs](https://docs.paperless-ngx.com/usage/#workflow-placeholders) are expanded — note they are **plain** (`{{ id }}`), not `{{ document.id }}`. The most reliable one is `{{ id }}`; if your Paperless version renders it literally, n8n can instead parse the document id from `doc_url` (`{{ doc_url }}` ends with `/documents/<id>/`).

Save and enable the workflow. It fires after a document finishes consuming, so the OCR text is ready when n8n fetches it.

## n8n — workflow import

Workflows are version-controlled in the repo at `workflows/*.json` and mounted read-only into the container (`/home/node/.n8n/workflows`). On every container start n8n auto-imports them before booting — no manual import needed.

1. Create two credentials (one-time, after n8n is up):
   - **HTTP Basic Auth** → `Paperless` (user/pass as per `PAPERLESS_ADMIN_USER` / `PAPERLESS_ADMIN_PASSWORD` in `.env`).
   - **HTTP Header Auth** → `OpenRouter` (API key from openrouter.ai/keys).
2. In the imported workflow, assign each node the matching credential.
3. Activate the workflow (imports start inactive).
4. Check the `Call OpenRouter` node's model (default `openai/gpt-4o-mini:json`, the `:json` suffix forces JSON output on OpenRouter).

> Note: the JSON file is the source of truth. UI edits are overwritten on the next restart — edit the file in the repo and redeploy instead.

### Pipeline
1. **Paperless Webhook** — receives the POST, answers 200 immediately.
2. **Get Document from Paperless** — fetches `http://paperless:8000/api/documents/{id}/` (returns the OCR text in `content`).
3. **Call OpenRouter** — chat completion extracting structured fields.
4. **Parse Summary** — `JSON.parse` of the model reply → `vendor`, `invoice_number`, `amount`, `currency`, `invoice_date`, `due_date`, `description`.

### Test
Upload an invoice to Paperless → the webhook fires. In n8n open the workflow → **Executions** to inspect the `Parse Summary` output.

### Troubleshooting
- Check n8n sidecar/proxy: `docker exec n8n-ts sh -c 'wget -qO- http://n8n-app:5678/healthz'` → expect `{"status":"ok"}`.
- The app container is named `n8n-app`: the DNS name `n8n` belongs to the Tailscale sidecar, so internal calls must use `n8n-app`.