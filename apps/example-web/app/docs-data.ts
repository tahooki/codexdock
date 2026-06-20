export const navItems = [
  {
    href: "/",
    label: "Overview",
  },
  {
    href: "/api-docs",
    label: "API Docs",
  },
  {
    href: "/playground",
    label: "Playground",
  },
  {
    href: "/architecture",
    label: "Architecture",
  },
  {
    href: "/results",
    label: "Results",
  },
  {
    href: "/security",
    label: "Security",
  },
] as const;

export const runtimeDiagram = `sequenceDiagram
  autonumber
  actor User as "User"
  participant UI as "Host App UI"
  participant Host as "Host App Routes"
  participant SDK as "@codexdock/sdk"
  participant Store as "Persistence Adapter"
  participant Worker as "Local codexdock CLI"
  participant Codex as "Local Codex app-server"

  User->>UI: Start AI generation
  UI->>Host: POST app generation route
  Host->>Host: Resolve owner from cookie/session
  Host->>SDK: invoke({ type, prompt, parameters }, owner)
  SDK->>Store: createInvocation(status: pending, owner)
  Store-->>SDK: invocation record
  SDK-->>Host: invocationId + statusUrl
  Host-->>UI: pending handle

  Worker->>Host: POST /worker/connect
  Host->>SDK: authenticate worker token
  SDK->>Store: upsertWorker(owner, capabilities)
  Store-->>SDK: worker record
  SDK-->>Worker: polling policy

  loop Short polling with backoff
    Worker->>Host: POST /worker/next
    Host->>SDK: authenticate worker token
    SDK->>Store: claimNextInvocation(owner, capabilities)
    Store-->>SDK: pending invocation or null
    SDK-->>Worker: invocation or 204
  end

  Worker->>Codex: Run prompt through app-server
  Codex-->>Worker: generated result
  Worker->>Host: POST /worker/result
  Host->>SDK: validate worker claim + result schema
  SDK->>Store: completeInvocation(result)
  UI->>Host: GET statusUrl
  Host-->>UI: completed result`;

export const ownerDiagram = `sequenceDiagram
  autonumber
  participant Browser as "Browser"
  participant Host as "Host App"
  participant Pairing as "Pairing Store"
  participant SDK as "@codexdock/sdk"
  participant Store as "Persistence Adapter"
  participant Worker as "Owner-Scoped CLI"

  Browser->>Host: Open playground
  Host->>Browser: Set anon owner cookie
  Browser->>Host: POST create pairing code
  Host->>Pairing: Store code hash for anon owner
  Host-->>Browser: Show codexdock connect --code

  Worker->>Host: POST /pairing/exchange with code
  Host->>Pairing: Atomically consume valid code
  Pairing-->>Host: owner scope
  Host->>Pairing: Store worker token hash
  Host-->>Worker: worker token

  Browser->>Host: Create generation
  Host->>SDK: invoke(input, owner: anon uuid)
  SDK->>Store: createInvocation(owner: anon uuid)

  Worker->>Host: POST /worker/next with token
  Host->>SDK: authenticate token
  SDK->>SDK: token resolves to anon owner
  SDK->>Store: claim pending where owner matches
  Store-->>SDK: matching invocation only
  SDK-->>Worker: work item

  Worker->>Host: POST /worker/result
  Host->>SDK: authenticate token
  SDK->>SDK: require same owner, same workerId, status running
  SDK->>Store: complete invocation`;

export const routeRows = [
  ["GET", "/api/codexdock/discovery", "Returns the host endpoint manifest used by the CLI."],
  ["POST", "/api/codexdock/pairing/code", "Creates a short-lived browser-scoped pairing code."],
  ["POST", "/api/codexdock/pairing/exchange", "Exchanges a pairing code for an owner-scoped worker token."],
  ["POST", "/api/codexdock/invoke", "Creates a pending owner-scoped invocation."],
  [
    "GET",
    "/api/codexdock/invocations/[invocationId]",
    "Reads invocation status and completed results for the owner.",
  ],
  ["POST", "/api/codexdock/worker/connect", "Registers or refreshes a local worker connection."],
  ["GET", "/api/codexdock/worker/status", "Reports worker and queue status for operations."],
  ["POST", "/api/codexdock/worker/next", "Claims the next matching pending invocation."],
  ["POST", "/api/codexdock/worker/result", "Submits a validated worker result."],
] as const;

export const invocationUseCases = [
  {
    type: "generate_text",
    kind: "text",
    title: "Plain text the product can display immediately.",
    use: "Use this for captions, summaries, prompts, labels, messages, and other copy where the result is one text field.",
    examples: "Captions, summaries, prompts, copy",
    result: 'kind: "text", text: "..."',
  },
  {
    type: "generate_object",
    kind: "object",
    title: "Structured data for UI or domain workflows.",
    use: "Use this when the host needs JSON-shaped output it can validate, render, or pass into product logic.",
    examples: "Structured UI data or domain objects",
    result: 'kind: "object", object: { ... }',
  },
  {
    type: "generate_file",
    kind: "file",
    title: "A generated artifact with a filename and content.",
    use: "Use this for markdown, source files, docs, config snippets, or any text file the host wants to save or preview.",
    examples: "Markdown, source files, generated artifacts",
    result: 'kind: "file", filename, content',
  },
  {
    type: "generate_image",
    kind: "image",
    title: "An inline image artifact for product media.",
    use: "Use this for thumbnails, avatars, previews, and visual assets that should come back as an image result envelope.",
    examples: "Thumbnails, avatars, visual assets",
    result: 'kind: "image", mediaType, base64',
  },
] as const;
