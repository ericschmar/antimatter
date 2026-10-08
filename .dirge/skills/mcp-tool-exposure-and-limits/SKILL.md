---
name: mcp-tool-exposure-and-limits
description: Configure MCP server tool exposure and troubleshoot LLM provider tool-array limits, including GitLab MCP allowlisting.
---

# MCP tool exposure and limits

Configure an MCP server's advertised tool surface and diagnose provider failures when the request contains too many tools.

Use this when enabling an MCP server produces a tool-array limit error, or when a server must expose only a specific workflow.

## Diagnose tool-budget failures

Errors such as `Invalid 'tools': array too long` mean the client submitted more tools than the provider permits.

- Read the error for the allowed maximum and actual count.
- Disable other MCP servers only to determine whether the new server alone exceeds the cap.
- If it still exceeds the cap alone, do not keep disabling unrelated servers: this is an advertised-tool-surface problem, not an authentication or connection failure.

## Reduce the advertised tool surface

Choose the smallest supported option:

1. Configure the server to expose only needed tool groups or individual tools.
2. Enable the client's tool search, deferred loading, or dynamic discovery so it does not send every tool on every request.
3. Use a smaller server variant or filtering proxy.
4. Use a provider deployment with a larger per-request tool limit.

Ask for the MCP client and server configuration only when their exact configuration controls are necessary.

## GitLab MCP: restrict to selected operations

For `@zereight/gitlab-mcp`, `GITLAB_TOOLSETS` only opts into additional toolsets; it does not suppress the server's default always-exposed groups. Setting `GITLAB_TOOLSETS=merge_requests` therefore cannot make an MR-only server.

Use the comma-separated `GITLAB_TOOLS` allowlist for exact operations. For example:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@zereight/gitlab-mcp"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "${GITLAB_PERSONAL_ACCESS_TOKEN}",
        "GITLAB_API_URL": "https://gitlab.com/api/v4",
        "GITLAB_TOOLS": "get_merge_request,list_merge_requests,create_merge_request_note"
      }
    }
  }
}
```

Use operation names supported by the installed server version. If default tools still appear despite an allowlist, use `GITLAB_DENIED_TOOLS_REGEX` where that version supports it.

## Verification

- Restart the MCP client after changing environment configuration.
- Confirm the server's advertised tool count is at or below the provider limit.
- Confirm that the intended operations remain available and excluded operations do not.