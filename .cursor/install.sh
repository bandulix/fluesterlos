#!/usr/bin/env bash
set -euo pipefail

sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
npm ci
