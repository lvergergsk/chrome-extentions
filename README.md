# Chrome Extensions

Personal Chrome extensions live here. Each top-level folder is one extension.

## Extensions

- `utils` - personal utility extension starter.

## Load An Extension Locally

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click **Load unpacked**.
4. Select the extension folder, for example `utils`.

## Local API Example

The `utils` extension includes a small localhost API example.

In one terminal, start the API server and leave it running:

```bash
npm run api:utils
```

In another terminal, test the API directly:

```bash
curl -sS -X POST http://127.0.0.1:8787/api/hello -H 'content-type: application/json' -d '{"note":"hello from curl"}'
```

If curl says it could not connect to port `8787`, the API server is not running.

After starting the local API server, reload the unpacked extension and click **Call Local API** in the popup.

## Package Later

Keep each extension self-contained in its own folder so public, private, and experimental extensions can evolve independently.
