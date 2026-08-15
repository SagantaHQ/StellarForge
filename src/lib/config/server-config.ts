/**
 * Server-side configuration for StellarForge IDE.
 *
 * This file is editable by admins only. It controls features that affect
 * server resources (e.g. autocomplete mode, LSP server).
 *
 * Changes require a server restart to take effect.
 */

export interface ServerConfig {
  /** Autocomplete mode:
   *   - "simple": local rustdoc JSON index + source parsing (default)
   *   - "lsp": rust-analyzer via WebSocket (requires LSP gateway server)
   */
  autocompleteMode: "simple" | "lsp";

  /** Whether the LSP gateway server (rust-analyzer) is enabled.
   *  When false, the LSP server is not started by bm2 and LSP mode
   *  is unavailable. Set to true to enable rust-analyzer autocomplete.
   */
  lspServerEnabled: boolean;

  /** LSP gateway server port (only used if lspServerEnabled = true) */
  lspPort: number;
}

export const serverConfig: ServerConfig = {
  autocompleteMode: "simple", // "simple" or "lsp"
  lspServerEnabled: false,    // set to true to enable rust-analyzer
  lspPort: 3099,
};
