#!/bin/sh
# SBF-build voor obp-core: SBPF v3 met platform-tools v1.54.
#
# WAAROM v1.54 + --arch v3 (alles gemeten, zie STATUS.md sectie 9.3):
# - --arch v3: SBPF-v0-builds (het cargo build-sbf-default) faalen op moderne
#   Agave (devnet 4.3.0-rc.0) met "Access violation writing 48 bytes at
#   address 0x8" — v0-layout heeft 0x0-0x11F unallocated, v3 heeft .rodata@0.
#   Zelfde symptoom als active-defense STATUS sectie 30; die "v1.54-defect"
#   was dus de v0-arch, niet de toolchain.
# - v1.54: v1.52-platform-tools heeft GEEN sbpfv3-solana-solana-standaard-
#   bibliotheek (gemeten rustlib: sbpf/sbpfv1/sbpfv2 only) → v3 kan er niet
#   mee. v1.54 wél (~/.cache/solana/v1.54/platform-tools/rust, rustc 1.89.0-dev).
#
# Gebruik: ./build-sbf.sh   (optioneel met doorgeef-args, bijv. --debug)
exec cargo build-sbf --tools-version v1.54 --arch v3 "$@"
