# KeyCRM MCP

Remote MCP bridge that gives ChatGPT access to the documented KeyCRM OpenAPI.

## Security

- The KeyCRM token is stored only as a server environment variable.
- The MCP endpoint requires a separate access token.
- Read operations are separate from writes.
- Create/update tools require `CONFIRM`; delete requires `CONFIRM DELETE`.
- API paths are restricted to the KeyCRM v1 base URL.

## Render settings

- Runtime: Node
- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`
- Environment variables: `KEYCRM_API_TOKEN`, `MCP_ACCESS_TOKEN`

The MCP URL is `https://YOUR-SERVICE.onrender.com/mcp?token=MCP_ACCESS_TOKEN`.

Never commit `.env` or paste tokens into source code.
