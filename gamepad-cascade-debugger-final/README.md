# Gamepad Debugger — CSS Layers · Multi-Gamepad · Light/Dark

A friendly Gamepad API debugger to support the article idea **“Debugging the Gamepad API with CSS Cascade Layers.”**

- Multi-controller support
- Live UI for buttons, sticks, triggers
- `@layer debug` overlay toggle
- Light/Dark theme
- Recording + JSON/CSV export
- Snapshots
- Ghost input replay
- Controller connection indicator

## Run locally
1. Serve the folder (Gamepad API needs http/https):
   - Python: `python -m http.server 5500`
   - Node: `npx http-server -p 5500`
2. Open `http://localhost:5500`.
3. Click **Start**, press any button on your controller to wake it.
4. Use **Record**, **Export**, **Snapshot**, **Replay Ghost**.

## Tip
Mobile browsers often don’t fully support the Gamepad API — best to test on desktop Chrome/Firefox/Edge (or Safari 16+).

Enjoy!
