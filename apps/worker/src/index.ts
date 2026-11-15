import { createApp } from "./app";
import { scheduled } from "./scheduled";

export { PlaidItemSync } from "./durable/plaid-item-sync";

export default { fetch: createApp().fetch, scheduled };
