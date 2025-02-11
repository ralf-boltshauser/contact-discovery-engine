# Contact Discovery Engine

A powerful TypeScript-based tool designed to discover contact information from websites. This tool can help you extract email addresses, phone numbers, and other contact details from web pages automatically.

## Features

- Automated contact information extraction from websites
- Support for email addresses and phone numbers
- Built with TypeScript for type safety
- Uses Playwright for reliable web scraping
- Concurrent processing with rate limiting
- Command-line interface with progress indicators

## Prerequisites

- Node.js (v16 or higher)
- pnpm (recommended) or npm
- Docker (for containerized deployment)

## Docker Setup and Usage

### Installing Docker

#### Windows
1. Download and install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
2. During installation, ensure WSL 2 (Windows Subsystem for Linux) is enabled
3. Start Docker Desktop after installation

#### macOS
1. Download and install [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop)
2. For Apple Silicon (M1/M2) Macs, make sure to download the Apple Silicon version
3. Start Docker Desktop after installation

#### Linux (Ubuntu/Debian)
```bash
# Update package index
sudo apt-get update

# Install prerequisites
sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Set up stable repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# Install Docker Compose
sudo apt-get install -y docker-compose
```

### Running the Application

1. Clone and navigate to the repository:
```bash
git clone https://github.com/yourusername/contact-discovery-engine.git
cd contact-discovery-engine
```

2. Build and start the container:
```bash
docker-compose up --build
```

To run in detached mode (background):
```bash
docker-compose up -d
```

3. Access the application:
- Open your web browser and navigate to `http://localhost:4242`
- The API endpoints will be available at `http://localhost:4242/api`

### Common Docker Commands

```bash
# Stop the application
docker-compose down

# View logs
docker-compose logs -f

# Rebuild the container (after code changes)
docker-compose up --build

# Check container status
docker-compose ps

# Remove all containers and networks
docker-compose down --volumes
```

### Troubleshooting

1. If port 4242 is already in use, modify the port mapping in `docker-compose.yml`
2. Ensure Docker Desktop is running (Windows/macOS)
3. On Linux, ensure the Docker daemon is running:
```bash
sudo systemctl status docker
# If not running:
sudo systemctl start docker
```

4. If you encounter permission issues on Linux:
```bash
# Add your user to the docker group
sudo usermod -aG docker $USER
# Log out and back in for changes to take effect
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/contact-discovery-engine.git
cd contact-discovery-engine
```

2. Install dependencies:
```bash
pnpm install
```

## Usage

1. Build the project:
```bash
pnpm build
```

2. Run the tool:
```bash
pnpm start
```

For development:
```bash
pnpm dev
```

## Scripts

- `pnpm build` - Compiles TypeScript code
- `pnpm start` - Runs the compiled application
- `pnpm dev` - Runs the application in development mode with hot reloading
- `pnpm lint` - Runs ESLint for code linting
- `pnpm format` - Formats code using Prettier

## Dependencies

### Main Dependencies
- `playwright` - Web automation
- `jsdom` - HTML parsing
- `zod` - Runtime type checking
- `chalk` - Terminal styling
- `ora` - Elegant terminal spinners
- `cli-table3` - Pretty console tables
- `p-limit` - Concurrency control

### Dev Dependencies
- TypeScript and related tools
- ESLint for code linting
- Prettier for code formatting

## License

ISC

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Author

Ralf Boltshauser

## Todos
- [ ] make it accessible
- [ ] profiles -> if a site yields more than 4 emails, it probably is a contact / team page or smth, then pass it to llm to create profiles of the people found.
- [ ] 
