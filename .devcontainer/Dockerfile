# Devcontainer image for Quorum (issue #299).
#
# Installs every prerequisite listed under "Prerequisites" in CONTRIBUTING.md,
# so a first-time contributor can open the repo in a devcontainer (GitHub
# Codespaces or the VS Code "Dev Containers" extension) and go straight to
# `cargo build` / `npm install` without a manual toolchain setup:
#
#   * Node.js 20 + npm      frontend, SDK and integration tests
#   * Rust stable + wasm32  Soroban contract compilation
#   * clippy + rustfmt      contract linting (`make lint-contracts`)
#   * Stellar CLI 25.2.0    contract deployment and invocation
#
# The Stellar CLI is installed from the pinned release tarball instead of
# `cargo install stellar-cli --features opt`, for the same reason the release
# workflow does it: the checksum is verifiable and the install takes seconds
# rather than a full dependency compile. The version and both checksums match
# the ones pinned in .github/workflows/release.yml.
FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

ARG NODE_MAJOR=20
ARG STELLAR_CLI_VERSION=25.2.0
ARG STELLAR_CLI_SHA256_AMD64=da809a7b6ec3e66a5dd6ebdf199cdd638007bd5c063bfd6d18ae63a18b1b86b6
ARG STELLAR_CLI_SHA256_ARM64=8238a3a0a583f53df0b4daa16df9210e0173204ee67f52dc8bc2302ad9b96d02

ENV DEBIAN_FRONTEND=noninteractive

# --- Node.js -------------------------------------------------------------
# NodeSource keeps the major version in the apt source, so the image ships
# the newest Node 20 patch release instead of a pinned (and soon stale) one.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# --- Rust + wasm32 target ------------------------------------------------
# System-wide CARGO_HOME/RUSTUP_HOME (rather than the image user's home) so
# the toolchain is on PATH for every user the devcontainer runs as.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:${PATH}
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain stable \
 && rustup target add wasm32-unknown-unknown \
 && rustup component add clippy rustfmt \
 && chmod -R a+w "${RUSTUP_HOME}" "${CARGO_HOME}"

# --- Stellar CLI ---------------------------------------------------------
# The release tarball is named after the Rust target triple, which does not
# match dpkg's architecture names, so map between the two.
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) target="x86_64"; sha256="${STELLAR_CLI_SHA256_AMD64}" ;; \
      arm64) target="aarch64"; sha256="${STELLAR_CLI_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    archive="stellar-cli-${STELLAR_CLI_VERSION}-${target}-unknown-linux-gnu.tar.gz"; \
    curl -fsSL -o "${archive}" \
      "https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/${archive}"; \
    echo "${sha256}  ${archive}" | sha256sum --check --strict; \
    tar -xzf "${archive}" stellar; \
    install -m 0755 stellar /usr/local/bin/stellar; \
    rm -f "${archive}" stellar; \
    stellar --version

# Fail the image build rather than the first `cargo build` if a prerequisite
# silently went missing.
RUN node --version \
 && npm --version \
 && cargo --version \
 && rustup target list --installed | grep -qx wasm32-unknown-unknown \
 && cargo clippy --version \
 && stellar --version
