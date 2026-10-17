import { registerHooks } from "node:module";
import { extname } from "node:path";
import { existsSync } from "node:fs";

// Keep tests local: bindings are supplied in memory, with no Cloudflare account.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: "data:text/javascript,export class WorkflowEntrypoint { constructor(ctx, env) { this.env = env; } }",
        shortCircuit: true,
      };
    }
    if (
      context.parentURL?.endsWith(".ts") &&
      specifier.startsWith(".") &&
      !extname(specifier)
    ) {
      specifier += existsSync(new URL(`${specifier}.ts`, context.parentURL))
        ? ".ts"
        : "/index.ts";
    } else if (specifier.startsWith("dayjs/plugin/") && !extname(specifier)) {
      specifier += ".js";
    }
    return nextResolve(specifier, context);
  },
});
