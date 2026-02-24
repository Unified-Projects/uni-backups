# Contributing to Uni-Backups

Thank you for your interest in contributing to Uni-Backups! This document outlines the process for contributing to this project.

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker and Docker Compose

### Development Setup

This project uses Docker for local development with hot-reload support. The docker-compose.yml mounts your local codebase into the containers, so changes to the source code are reflected immediately.

1. Fork the repository from `main` branch
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Uni-Backups.git
   cd Uni-Backups
   ```
3. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
4. Copy the example config file:
   ```bash
   cp config/backups.example.yml config/backups.yml
   ```
5. Start the development environment:
   ```bash
   docker compose up -d
   ```
6. The services will be available at:
   - Web: http://localhost
   - API: http://localhost/api

Changes made to files in `apps/*/src` and `packages/*` will be automatically reflected.

## Pull Request Process

1. Create a new branch from `main` for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and ensure all tests pass:
   ```bash
   pnpm test
   ```

3. Run linting and type checks:
   ```bash
   pnpm lint
   pnpm type-check
   ```

4. Format your code:
   ```bash
   pnpm format
   ```

5. Push your branch to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

6. Open a Pull Request against the `main` branch

7. Ensure your PR description clearly describes the problem and solution

## Reporting Issues

When reporting issues, please include:

- A clear description of the problem
- Steps to reproduce the issue
- Expected behavior vs actual behavior
- Any relevant error messages or logs
- Environment details (OS, Node version, etc.)

## License Agreement

By contributing to Uni-Backups, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).

Contributions must be your original work or you must have the right to submit it under this license.
