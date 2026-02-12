export UID=$(id -u)
export GID=$(id -g)
docker compose --env-file ./.env.local up
