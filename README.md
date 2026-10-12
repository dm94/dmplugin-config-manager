# DmPlugin Config Manager

Local, independent panel with no npm dependencies to read and coordinate multiple DarkBot bots via DmPlugin's MCP Bridge.

## Requirements

- Node.js 20 or higher (includes `fetch`; no packages need to be installed).
- DmPlugin loaded on each bot, with MCP enabled and a configured port (default `9876`).
- An OpenAI-compatible chat endpoint (route `/chat/completions`), a model identifier, and an API key if the provider requires one.

## Running on Windows

From the repository root:

```powershell
node dmplugin-config-manager/manager.js
```

Open <http://127.0.0.1:8765/>. To use a different port:

```powershell
node dmplugin-config-manager/manager.js --port 8766
```

The server only listens on loopback. Press `Ctrl+C` in the terminal to stop it; closing the tab does not stop the process.

## Usage

1. In **OpenAI-compatible base URL**, specify the provider's base URL (e.g., `https://api.example.com/v1`), the exact model identifier, and the API key if needed. The manager adds `/chat/completions`; it also accepts a URL that already ends with that path.
2. Add each bot with a name and its MCP port. When connecting, the manager reads the profile list and status directly from MCP; no need to enter profiles or descriptions.
3. The first review is scheduled after connecting, and subsequent reviews use the configured interval (8 hours by default).
4. **Apply saved profile** allows applying only a profile recommendation that still exists in MCP. Disable it to receive recommendations without automatic changes.

Local configuration is saved in `~/.dmplugin-manager/state.json` (Windows: user folder). You can change the location with `DM_MANAGER_HOME`. The file stores the API key locally with private permissions on POSIX systems. The key is never returned to the browser; game data and profiles are sent to the chosen endpoint. Check your provider's privacy policy.

## Capabilities and Limits

The queried MCP offers state, stats, inventory, profiles, and events resources, plus `set_profile` and `set_config`. No tool for creating profiles or buying equipment was observed. Therefore, this manager:

- Only switches to existing profiles when recommended and automatic application is enabled.
- Does not create new profiles, buy items, spend credits/uridium, or freely modify settings.
- Reserves uridium for doors and sends the configured provider a limited summary of the selected bot's state.

Available inventory may not reflect all equipment properties or levels; recommendations do not guarantee optimal configuration.

The DmPlugin MCP publishes the list of profiles (`bot://profiles`) but not which one is active. For this reason, the manager does not request that data: it only records the last profile it applied (`set_profile`) and shares it with the AI as context. If you manually switch profiles in DarkBot, the manager will not know and may recommend switching back to another existing profile.

## Testing

```powershell
node --test dmplugin-config-manager/tests/*.test.js
node --check dmplugin-config-manager/app.js
```
