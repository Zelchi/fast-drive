# Fast Drive

Gerenciador de arquivos com workspaces, compartilhamento público e aplicativo desktop.

## Requisitos

- Node.js 24+
- Yarn 1.22+
- Rust e dependências do Tauri para o aplicativo desktop

## Desenvolvimento

```bash
cp .env.example .env
yarn install
yarn dev
```

Frontend: `http://localhost:7123`  
Backend: `http://localhost:7000`

Para executar o aplicativo desktop:

```bash
yarn desktop:dev
```

Na primeira abertura, o aplicativo solicita o endereço do servidor.

## Testes e qualidade

```bash
yarn test
yarn lint
```

## Docker

Configure `OWNER_SERIAL` no `.env` e execute:

```bash
docker compose up --build -d
```

## Release desktop

As releases são iniciadas por tags no formato:

```bash
git tag -a desktop-v0.1.0 -m "Fast Drive Desktop v0.1.0"
git push origin desktop-v0.1.0
```
