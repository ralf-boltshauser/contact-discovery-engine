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
