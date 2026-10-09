# L'ARTISAN — Chat Interno API release manifest

Release: `chat-interno-v1`

This deployment archive intentionally contains only application code. It does **not** contain `config.local.php`, database credentials, API keys, private certificates, environment secrets, user data, or logs.

## Included files

| File | SHA-256 |
| --- | --- |
| `index.php` | `EB0FFBB8AD866795D567CE3AB9150377EE58B5A127A5F669D56A47546E7AEA2E` |
| `internal_chat.php` | `86AF8F9282B48F00202D8F3BC6EE0A5B6F52C083C19B96150C3CB5E10D55AE49` |

## Structural compatibility

The code expects the existing production API directory layout: `index.php`, `bootstrap.php`, `config.local.php`, and the existing session/authentication layer. `config.local.php` remains in place on the server and is not replaced by this release.

## Recovery

The server-side pre-deploy copy of `index.php` is retained alongside the API as `index.php.backup-chat-predeploy-2026-10-09`. Restoring it reverses the route integration; removing `internal_chat.php` is not necessary for rollback because it is not loaded by the restored entrypoint.
