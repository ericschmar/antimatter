---
name: gitlab-mcp-tool-exposure
description: Configure zereight/gitlab-mcp tool exposure, especially restricting available GitLab tools to a selected workflow such as merge requests.
---

# GitLab MCP tool exposure

Use this when configuring the `@zereight/gitlab-mcp` server’s available MCP tools.

## Select only specific tools

`GITLAB_TOOLSETS` is an opt-in mechanism; it does not disable default toolsets. Merge Requests belongs to the default, always-exposed groups, so `GITLAB_TOOLSETS=merge_requests` is redundant and cannot yield an MR-only server.

Use `GITLAB_TOOLS` as a comma-separated individual-tool allowlist instead:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@zereight/gitlab-mcp"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "${GITLAB_PERSONAL_ACCESS_TOKEN}",
        "GITLAB_API_URL": "https://gitlab.com/api/v4",
        "GITLAB_TOOLS": "list_merge_requests,get_merge_request,list_merge_request_changed_files,get_merge_request_file_diff,create_merge_request,update_merge_request,merge_merge_request"
      }
    }
  }
}
```

Include only the operations required for the workflow. If an installed server version exposes default tools despite the allowlist, use `GITLAB_DENIED_TOOLS_REGEX` for unwanted tools or upgrade and check the release’s feature-toggle documentation.

## Enable optional categories

Use `GITLAB_TOOLSETS=<toolset-id,...>` only to add opt-in groups (for example, pipelines, releases, or webhooks). `GITLAB_TOOLSETS=all` enables all optional groups. Legacy `USE_PIPELINE`, `USE_MILESTONE`, and `USE_GITLAB_WIKI` flags enable their corresponding groups.

## Verification

```sh
npx -y @zereight/gitlab-mcp --help
```