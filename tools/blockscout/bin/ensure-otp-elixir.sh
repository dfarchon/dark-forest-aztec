#!/usr/bin/env bash
# Put Hex.pm precompiled OTP + Elixir on PATH. No Docker, no Cargo.
set -euo pipefail

BLOCKSCOUT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TC="${BLOCKSCOUT_HOME}/.toolchain"
ELIXIR_V="${BLOCKSCOUT_ELIXIR_VERSION:-1.19.6}"
OTP_V="${BLOCKSCOUT_OTP_VERSION:-27.3.4}"
otp_dir="${TC}/otp"
elixir_dir="${TC}/elixir"

mkdir -p "${TC}"

arch_raw="$(uname -m)"
case "${arch_raw}" in
  x86_64|amd64) hex_arch=amd64 ;;
  aarch64|arm64) hex_arch=arm64 ;;
  *)
    echo "[blockscout] unsupported CPU ${arch_raw} for Hex OTP builds" >&2
    exit 1
    ;;
esac

if [[ ! -x "${otp_dir}/bin/erl" ]]; then
  id="$(grep '^ID=' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || echo ubuntu)"
  ver="$(grep '^VERSION_ID=' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || echo 24.04)"
  if [[ "${id}" != ubuntu ]]; then
    echo "[blockscout] Hex OTP builds target Ubuntu; OS id=${id}, trying ubuntu-24.04 tarball" >&2
    lts=24.04
  else
    case "${ver}" in
      20*|21*) lts=20.04 ;;
      22*|23*) lts=22.04 ;;
      *) lts=24.04 ;;
    esac
  fi
  echo "[blockscout] downloading OTP ${OTP_V} (${hex_arch}, ubuntu-${lts})"
  tmp="$(mktemp -d)"
  url="https://builds.hex.pm/builds/otp/${hex_arch}/ubuntu-${lts}/OTP-${OTP_V}.tar.gz"
  curl -fsSL "${url}" -o "${tmp}/otp.tgz"
  rm -rf "${otp_dir}"
  mkdir -p "${otp_dir}"
  tar xzf "${tmp}/otp.tgz" --strip-components 1 -C "${otp_dir}"
  (cd "${otp_dir}" && ./Install -sasl "${otp_dir}")
  rm -rf "${tmp}"
fi

if [[ ! -x "${elixir_dir}/bin/mix" ]]; then
  echo "[blockscout] downloading Elixir ${ELIXIR_V} (otp-27)"
  tmp="$(mktemp -d)"
  curl -fsSL "https://builds.hex.pm/builds/elixir/v${ELIXIR_V}-otp-27.zip" -o "${tmp}/elixir.zip"
  rm -rf "${elixir_dir}"
  mkdir -p "${elixir_dir}"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "${tmp}/elixir.zip" -d "${elixir_dir}"
  else
    python3 -m zipfile -e "${tmp}/elixir.zip" "${elixir_dir}"
  fi
  rm -rf "${tmp}"
fi

export PATH="${otp_dir}/bin:${elixir_dir}/bin:${PATH}"
