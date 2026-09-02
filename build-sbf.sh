#!/bin/sh
# SBF-build voor obp-core, met platform-tools v1.52 GEPIND (overgenomen pin).
#
# WAAROM DE PIN: active-defense (zelfde machine, zelfde cargo-build-sbf 4.1.0)
# heeft aangetoond dat platform-tools v1.54 (rustc-fork daa3af4) een DEFECTE
# .so produceert ("Access violation writing 48 bytes at address 0x8, in
# unallocated region", active-defense STATUS.md sectie 30); v1.52 (rustc-fork
# 790f153) produceert een werkende .so. Voor OBP zelf is dat nog NIET gemeten —
# de pin blijft staan totdat v1.54 hier zelf gefaald heeft of bewezen is dat het
# hier meeviel (STATUS.md sectie 5: geen aannames, eerst meten).
#
# Gebruik: ./build-sbf.sh   (optioneel met doorgeef-args, bijv. --debug)
exec cargo build-sbf --tools-version v1.52 "$@"
