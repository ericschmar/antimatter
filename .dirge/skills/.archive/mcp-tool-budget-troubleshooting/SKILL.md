---
name: mcp-tool-budget-troubleshooting
description: Diagnose MCP client failures caused by an LLM provider's maximum tools-per-request limit.
---

# MCP tool-budget troubleshooting

Use this when enabling an MCP server returns an API error such as `Invalid 'tools': array too long`.

## Diagnosis

- Read the provider error for both the allowed maximum and actual tool count.
- Compare the count after disabling other MCP servers. If the failing server alone exceeds the limit, this is not an MCP connection or authentication problem.
- Do not recommend repeatedly disabling unrelated servers once the single server's exposed tool count remains above the cap.

## Remedies

Choose the smallest available option:

1. Configure the MCP server to expose only required tool groups or individual tools.
2. Enable the client’s tool search, deferred tool loading, or dynamic discovery feature so it does not submit every tool with each request.
3. Use a smaller server variant or a proxy that filters the advertised tool list.
4. Use a provider/model deployment with a larger tool-array limit.

Ask for the client name and MCP server configuration only when an exact configuration setting is needed.

## Verification

```sh
python3 -c 'assert 152 > 128'
```