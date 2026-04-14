# Render Deployment

## Service settings

- Runtime: `Node`
- Root Directory: `indexer`
- Build Command: `npm install`
- Start Command: `npm run start`
- Health Check Path: `/health`

## Required environment variables

- `PONDER_RPC_URL_420420417`
  Use `https://eth-rpc-testnet.polkadot.io/` for Polkadot Hub TestNet.

## Recommended environment variables

- `DATABASE_URL`
  Strongly recommended for hosted deployments. If omitted, Ponder falls back to local `PGlite`, which is fine for local development but not durable across hosted restarts.

## Expected endpoints

- `/health`
  Returns the Ponder health status.
- `/`
  Returns a small JSON payload from the custom API entrypoint.
- `/graphql`
  GraphQL API for indexed data.
- `/sql/*`
  SQL client endpoint exposed by Ponder.

## Notes

- Local development uses `PGlite` automatically.
- Hosted production-like deployment should use `DATABASE_URL` so indexed state survives restarts and redeploys.
- The current config indexes:
  - `TreasuryPolicy`
  - `EscrowCore`
  - `ReputationSBT`
  on Polkadot Hub TestNet.
