// Moved to @abukhaled/gg-core. This shim re-exports it so existing relative
// imports (`./auth-providers.js`) and the `./core/auth` export keep resolving
// unchanged.
export {
  AUTH_PROVIDERS,
  getAuthProvider,
  describeAuthMethods,
  authPriorityNote,
} from "@abukhaled/gg-core";
export type {
  AuthMethod,
  ApiKeyVariant,
  AuthProviderMeta,
  AuthMethodMeta,
} from "@abukhaled/gg-core";
