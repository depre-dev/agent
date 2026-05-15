# AWS IAM policies

Pre-written policy documents ready to paste into the AWS console (or
`aws iam create-policy`) when Phase 3 enters its AWS-setup window. Each
file uses `<placeholder>` tokens for the values that depend on
account/region/key creation order.

| File                                  | Attached to role              | Allows                                                                      | Explicitly denies                                                  |
| ------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `averray-signer-prod-role.json`       | `averray-signer-prod-role`    | `kms:Sign` (ECDSA_SHA_256, DIGEST mode only) + `kms:GetPublicKey`           | `kms:ScheduleKeyDeletion`, `DisableKey`, `PutKeyPolicy`, `CreateGrant`, `ReplicateKey`, `UpdatePrimaryRegion` |

## Substituting placeholders

```bash
# Single-region testnet: drop the replica ARN line.
# Multi-region mainnet: fill both ARNs.
sed \
  -e 's|<primary-region>|eu-central-1|g' \
  -e 's|<account>|123456789012|g' \
  -e 's|<key-id>|abcd1234-aaaa-aaaa-aaaa-aaaaaaaaaaaa|g' \
  -e 's|<replica-region>|us-east-1|g' \
  averray-signer-prod-role.json > /tmp/averray-signer-prod-role.rendered.json

aws iam create-policy \
  --policy-name averray-signer-prod \
  --policy-document file:///tmp/averray-signer-prod-role.rendered.json \
  --description "Phase 3a — KMS sign-only permissions for the backend signer role"
```

## Why the deny statement is constrained to this role

`ExplicitDenyDangerousOpsForSignerRole` only protects against signer-role
credential compromise. Admin-path protection (root, IAM admins) requires
**all four** of:

1. KMS key policy that scopes `kms:PutKeyPolicy`, `kms:ScheduleKeyDeletion`,
   etc. to a multisig-approved admin role (not root).
2. Service Control Policies at the AWS Organization level.
3. Permission boundaries on the IAM admin users.
4. CloudTrail + CloudWatch alarms on the destructive actions (see
   `docs/SECRETS_MIGRATION.md` §3b-2 for the alarm list).

Putting the deny only here would create a false sense of security; the
above four layers are tracked separately.
