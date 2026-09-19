# Local runtime investigation

2026-09-20, recovery at **06:13 KST**, followed by actual local integration at06:21–06:32. **Docker engine access is recovered.** The recovery itself changed only the two socket-only runtime directories with preserved backups. The separate integration then downloaded pinned official binaries/model and started a new local Supabase stack; it did not change hosted settings.

## Follow-up integration result

Migration015 was subsequently applied locally and its deletion/late-callback/Daily-parent guards passed22 actual RPC checks with no model calls and complete cleanup. A fresh engine query still returned29.5.2/linux and all eleven retained core Supabase containers were running. The separate local UI fixture provisioner has also created two synthetic identities, seeded records, and verified Auth404 plus15 empty owned tables for each identity after cleanup; browser integration is a later check.

At07:45 KST the browser integration subsequently passed: six actual local database/RLS checks cover record-only and selected-memory deletion, conversation cascade, deleted-detail reload and account-isolated history/profile. Four separate controlled Edge/session-event branches cover late responses, terminal404 and form reset; those are mocks rather than actual model/OAuth success. All51 browser REST requests stayed local, external attempts0/model calls0. Both identities were removed and all15 owned tables were empty. See [local browser lifecycle](evidence/frontend-local-authenticated-lifecycle.json). The fresh07:44 engine query also returned29.5.2/Linux with11 core containers running. No further Docker restart, reset or socket change was required.

Native llama.cpp b11053 CPU with Qwen3.5-0.8B Q4_0 ran on127.0.0.1:8080 with a separate local API key. Both downloaded SHA-256 values were checked. The six actual health/auth/protocol/schema/repair checks passed; see [provider report](evidence/local-provider-smoke.json). The small-model responses establish compatibility, not Persona quality. The earlier readiness/proposal sections below describe the state before this download and execution.

Local Supabase applied migrations001–014. Actual anonymous Auth, RLS, five Edge authentication boundaries, native Chat, identical-request replay, persisted Tarot and retry invariance, and account cascade were exercised. Both tiny-model Tarot interpretations failed reply validation and stayed PARTIAL. The original [integration report](evidence/backend-local-supabase-smoke.json) retains all failures. A separate [no-model follow-up](evidence/backend-local-supabase-verification.json) corrected the local Kong CORS expectation and the cleanup table name, confirming both test accounts and15 owned tables absent, ledger0. It does not turn the failed interpretations into passes.

The local Vector collector uses `DOCKER_HOST=http://host.docker.internal:2375`, without a Unix socket mount. This Windows host has no2375/2376 listener, and `/_ping` from the same Docker network returns connection refused. The working Docker CLI uses `npipe:////./pipe/dockerDesktopLinuxEngine`. Thus centralized log collection is unavailable while the tested DB/Auth/Edge/native-provider paths work. No Docker TCP exposure or security setting was enabled.

After confirming the exact `jumzip` project/workdir labels and28 restarts, Main normally stopped only `supabase_vector_jumzip` at06:43KST to end its failed restart loop. It is retained in exited state. The other eleven local Supabase containers remained running, with health checks healthy where provided. No container or volume was removed.

For a future planned local start, the [official CLI exclusion option](https://supabase.com/docs/reference/cli/start) permits `supabase start -x vector`; direct container/serve logs remain usable. Restoring aggregate logs requires a separately tested Linux/WSL/dev-container Unix-socket or authenticated TLS configuration supported by [Vector](https://vector.dev/docs/reference/configuration/sources/docker_logs/#docker_host). These alternatives have not been executed. Do not enable unauthenticated2375 as an automatic workaround; see [Docker remote access](https://docs.docker.com/engine/daemon/remote-access/).

## Docker failure and recovery result

Docker Desktop is **4.76.0.228118**. The newest host backend log reports an Inference manager listener failure at **05:56:53 KST**, followed by backend cancellation and crash reporting at **05:57:25–26**. The failing path is `%LOCALAPPDATA%\Docker\run\dockerInference`. The remove operation reports that Windows cannot access the file; listener creation then reports an invalid filename/path syntax. This happens before a usable Linux engine is available.

Read-only metadata for that exact entry:

| Observation | Result |
| --- | --- |
| Kind visible to PowerShell | File, zero bytes; `Archive, ReparsePoint` |
| Link target/type | Neither ordinary symbolic-link target nor LinkType returned |
| Creation and last write | 2026-08-30 12:45:50 KST, unchanged by today's start attempt |
| Reparse metadata query | `fsutil reparsepoint query` also reports inaccessible file |
| Bounded AF_UNIX connection probe | `SocketException`, `InvalidArgument`, native error 10022; no payload sent |
| Initially remaining processes | Two backend processes and Docker UI/reporting processes |
| Existing diagnostic Handle utility | Neither `handle` nor `handle64` found |

The role, age and attributes strongly match a stale or inaccessible Windows AF_UNIX socket. The specific reparse tag and owning kernel/process handle could not be read, so kernel pinning is an inference rather than a confirmed cause. The sibling runtime directory also contains two old zero-byte reparse entries; they were only listed and were not changed.

Docker's official issue tracker contains closely matching first-hand reports: [issue 448](https://github.com/docker/desktop-feedback/issues/448) describes the same path/error and residual backend processes, and [issue 460](https://github.com/docker/desktop-feedback/issues/460) reports inaccessible socket entries even after all Docker processes stop. Both report that disabling the inference setting did not avoid listener initialization. These are open user reports, not a vendor-certified fix for this machine. No setting-toggle workaround was attempted.

Main approved one narrow recovery sequence. `docker desktop stop --timeout 15` returned exit 0 with “Docker Desktop is not running.” A subsequent independent process/pipe check found **zero Docker processes and zero Docker engine pipes**. The command then verified the exact resolved parent `%LOCALAPPDATA%\Docker\run`, the zero-byte non-directory reparse entry, and a unique backup destination in that same parent. A single `Move-Item -LiteralPath` attempt failed with `IOException`, HRESULT **-2147022976 / ERROR_CANT_ACCESS_FILE (1920)**. An earlier path-check syntax error stopped before attempting any move; that check was corrected before the one move attempt.

The file was not deleted or moved. No backup was created, no force-kill was used, and Docker was not restarted after the failed move. There was no WSL shutdown/termination, factory reset, recursive operation, reboot or permission change.

Main then authorized a second, explicitly bounded directory quarantine. At **06:07 KST**, Docker process count was again zero and `docker-desktop` was confirmed stopped. The exact `Docker\run` directory and its parent were ordinary directories, not reparse links; its direct children were exactly the three previously recorded zero-byte runtime socket entries, with no subdirectories or additional data. Both fully resolved source and unique backup paths were checked to remain inside the explicitly named Docker parent.

`Move-Item -LiteralPath` successfully moved that runtime directory to `%LOCALAPPDATA%\Docker\run.jumzip-backup-20260919T210707Z-8ea4531c`. All three original entries remain in that backup. A fresh empty `run` directory was created and the official Docker Desktop executable was launched hidden **once**. The new `dockerInference` entry was created at **06:07:08 KST**, demonstrating that this first listener obstruction was bypassed.

The next startup component then failed with the same access error: **Secrets Engine**, path `%LOCALAPPDATA%\docker-secrets-engine\engine.sock`, at **06:07:08.762 KST**. A bounded 15-second engine API version query produced no server response; only that read-only CLI query was timed out. The newly reported component path was not inspected, moved or deleted in this step. Its error was reported to Main before further action. Docker was still **not recovered at that intermediate checkpoint**.

Main subsequently authorized metadata-only inspection of the Secrets Engine directory and quarantine only if it contained a single zero-byte runtime socket. It was an ordinary directory with exactly one `engine.sock`, zero bytes, `Archive, ReparsePoint`, last written 2026-08-30; there were no database, vault, configuration, key or other files. No file contents were read. After another official normal-stop request and independent zero-process/stopped-WSL checks, that exact directory was moved to `%LOCALAPPDATA%\docker-secrets-engine.jumzip-backup-20260919T211014Z-39fdc879`. The original socket remains there. A new empty directory and one hidden official application launch followed at **06:10 KST**.

At **06:10:15**, startup failed again at the first `Docker\run\dockerInference` path. The previous failed Secrets Engine startup had created a fresh inference socket, and that socket became inaccessible on the next launch. This matches the repeated-runtime-socket pattern in issue 460, but still does not prove the kernel-level cause. No additional quarantine or restart was attempted without reporting this changed state. Both preserved backups remain; the current Secrets Engine directory was newly empty at the second attempt.

Main approved a final attempt with both known runtime directories clean simultaneously. The official normal-stop request again completed, with **zero Docker processes** and **WSL docker-desktop stopped**. Each exact ordinary directory, direct-child inventory and resolved backup containment was rechecked. `Docker\run` now had only its new zero-byte inference socket; `docker-secrets-engine` was empty. Both were moved to separate unique backups, both empty runtime directories were created, and the official application was launched hidden once at **06:13:16 KST**.

**That final attempt succeeded.** Docker's actual `desktop-linux` engine version API returned **Server 29.5.2 / API 1.54 / OS linux**, exit 0. New inference, ethernet and Secrets Engine sockets were created at 06:13:17; the analytics socket followed at 06:13:40. The inspected latest startup log contained no new cancellation/crash. This is an actual engine API response, not merely a running GUI process. No sample container, Supabase stack or model was started by this investigation.

All retained backups, with no deletion:

| Parent | Backup directory | Preserved contents |
| --- | --- | --- |
| `%LOCALAPPDATA%\Docker` | `run.jumzip-backup-20260919T210707Z-8ea4531c` | Original three old runtime sockets |
| `%LOCALAPPDATA%` | `docker-secrets-engine.jumzip-backup-20260919T211014Z-39fdc879` | Original old `engine.sock` |
| `%LOCALAPPDATA%\Docker` | `run.jumzip-backup-20260919T211315Z-087a6bd0` | Inference socket stranded by the first attempted restart |
| `%LOCALAPPDATA%` | `docker-secrets-engine.jumzip-backup-20260919T211316Z-1856f5b0` | Empty directory from the preceding attempt |

There was no reboot, WSL shutdown/termination, force-kill of Docker, settings change, update, recursive delete, or data/image/volume/distribution removal. The final API check establishes recovery at this checkpoint, not a guarantee against recurrence after another unclean application exit.

## WSL and hardware

Read-only queries outside the restricted agent sandbox, before the final recovery, produced:

| Item | Observed value |
| --- | --- |
| OS | Windows 11 Home, build 22631.6199 |
| WSL | 2.7.14.0; kernel 6.18.33.2-2 |
| Distribution | `docker-desktop`, WSL2, stopped |
| Active Docker context | `desktop-linux`, named pipe `dockerDesktopLinuxEngine` |
| HypervisorPresent | true |
| CPU | Intel Core i7-10700, 8 cores / 16 logical processors |
| RAM | 47.9 GiB total; approximately 27 GiB available at observation |
| GPU | NVIDIA GeForce RTX 3080 |
| GPU memory | `nvidia-smi`: 10,240 MiB total, 8,533 MiB free |
| NVIDIA driver | 596.21 |

The initial sandbox returned WSL/config/named-pipe access-denied errors; those were not treated as the host failure. Direct read-only host queries succeeded. `Win32_Processor` reported false virtualization fields while `HypervisorPresent` was true, so those fields alone do not establish disabled BIOS virtualization. The WMI AdapterRAM value was also not used because the dedicated NVIDIA query gives the actual 10 GiB capacity.

Installed WSL exceeds Docker's documented 2.1.5 minimum. A separate Ubuntu distribution is not required for Docker's Windows CLI; adding one is not a necessary response to this socket failure. [Docker WSL documentation](https://docs.docker.com/desktop/features/wsl/)

## Local inference readiness and smallest useful proposal

`llama-server` and `llama-cli` are absent from PATH. The repository has no `tools`, `runtime`, `.runtime`, `models` or `bin` runtime directory, and no llama/GGUF file was found in the scoped project search. No whole-user-directory scan was performed. The explicitly checked Docker inference runtime location supplied no usable llama executable.

An existing **Ollama 0.34.2** process is listening only on `127.0.0.1:11434`; its `list` command returns **zero models**. Its executable was identified from the running process, without changing PATH. This proves an installed local application, not a successful inference or native llama.cpp validation. No inference request was sent.

The smallest proposed independent path is a native Windows llama.cpp release plus a small GGUF, avoiding Docker for the initial provider-compatibility check. llama.cpp officially supports Windows server execution, CPU/GPU inference, OpenAI-compatible completion endpoints and constrained JSON. A native CUDA build can use the RTX 3080; a CPU build is a simpler fallback for a tiny smoke and avoids adding a CUDA build toolchain. Select and pin an official binary release/checksum before downloading; do not use a third-party binary mirror. [Official releases](https://github.com/ggml-org/llama.cpp/releases), [build documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md), [server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

For transport/schema validation only, the llama.cpp maintainers publish **Qwen3.5-0.8B Q4_0**, listed at **563 MB**; Q8_0 is listed at 834 MB. A 2,048-token context, one request at a time, and at most 128 generated tokens are conservative starting limits for this host. Weight size does not equal total runtime memory, so actual startup allocations must still be observed. This tiny model would not replace the approved production model or establish Korean Persona quality. Neither the binary nor model was downloaded. [Maintainer model files](https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF/tree/main)

Once a download and local launch are approved, the bounded check should record the pinned binary/model identity, start the server hidden on `127.0.0.1:8080`, verify `/health` and `/v1/models`, then run one synthetic Korean response and one strict JSON schema request through JumZip's existing provider. Check malformed/repair handling locally without changing production secrets. Shut down only the process started for this test. The official server documents `/health` readiness and `/v1` compatibility. [Server API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#api-endpoints)

A native host provider smoke would close only local inference compatibility. Full local Supabase Auth/DB/Edge integration can now proceed with the recovered Docker engine, but still requires its own actual tests. The repository's hosted smoke, PostgreSQL harness and public production deployment remain separate evidence. At handoff, Main separately reported downloading and hash-verifying llama.cpp b11053 CPU and the small Q4_0 model under `test-results/local-inference`; their launch/provider results are outside this investigation and have not been claimed passed here.
