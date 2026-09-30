#!/usr/bin/env bash
# Once, on a fresh Ubuntu 24.04 / Debian 12 VPS, as root:
#   bash server-setup.sh <deploy-user>      (uid 1000; on Ubuntu images: ubuntu)
# Updates the system, installs Docker (official repo), git, firewall (22, 80, 443),
# automatic security updates, fail2ban for SSH, a 2 GB swap file if there is no swap,
# and a deploy user in the docker group with root's SSH keys.
# SSH password login is NOT switched off here: do it after checking that key login works
# (see deploy/README.md), otherwise you can lock yourself out.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Запускать от root" >&2; exit 1; }
user=${1:?"Укажите пользователя для деплоя: bash server-setup.sh <user>"}
export DEBIAN_FRONTEND=noninteractive

. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) echo "Нужна Ubuntu или Debian, а тут $ID" >&2; exit 1 ;; esac

echo "== система"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git ufw fail2ban unattended-upgrades rsync

echo "== Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "== swap"
if [ -z "$(swapon --show)" ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

echo "== firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "== автообновления безопасности, fail2ban"
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban

echo "== пользователь $user"
if ! id "$user" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$user"
fi
usermod -aG docker "$user"
if [ "$(id -u "$user")" != 1000 ]; then
  echo "ВНИМАНИЕ: у $user uid $(id -u "$user"), а бэкенд в контейнере работает как uid 1000 —" \
       "возьмите пользователя с uid 1000 (на Ubuntu это ubuntu), см. deploy/README.md" >&2
fi
if [ -f /root/.ssh/authorized_keys ]; then
  home=$(getent passwd "$user" | cut -d: -f6)
  install -d -m 700 -o "$user" -g "$user" "$home/.ssh"
  touch "$home/.ssh/authorized_keys"
  cat /root/.ssh/authorized_keys >> "$home/.ssh/authorized_keys"
  sort -u -o "$home/.ssh/authorized_keys" "$home/.ssh/authorized_keys"
  chown "$user:$user" "$home/.ssh/authorized_keys" && chmod 600 "$home/.ssh/authorized_keys"
fi

echo
echo "Готово. $(docker --version); $(docker compose version)"
free -h | head -2
echo "Дальше — deploy/README.md, раздел «Первая установка», под пользователем $user."
