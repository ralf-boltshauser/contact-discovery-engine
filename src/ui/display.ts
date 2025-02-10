import chalk from "chalk";
import Table from "cli-table3";
import { Ora } from "ora";
import { TableUpdates } from "../types";

export function getTimestamp(): string {
  return chalk.gray(`[${new Date().toLocaleTimeString()}]`);
}

export function printHeader() {
  console.clear();
  console.log(
    chalk.cyan(`
╭──────────────────────────────────╮
│   ${chalk.bold("🎯 Contact Discovery Engine")}    │
╰──────────────────────────────────╯
`)
  );
}

export function createProgressTable(): Table.Table & {
  [index: number]: string[];
} {
  return new Table({
    head: [
      chalk.blue("Domain"),
      chalk.blue("Status"),
      chalk.blue("Sub-links"),
      chalk.blue("Progress"),
      chalk.blue("Emails Found"),
      chalk.blue("Last Update"),
    ],
    style: {
      head: [],
      border: [],
    },
  }) as Table.Table & { [index: number]: string[] };
}

export function createSummaryTable(): Table.Table {
  return new Table({
    head: [
      chalk.blue("Domain"),
      chalk.blue("Emails Found"),
      chalk.blue("Source URLs"),
      chalk.blue("Discovery Time"),
      chalk.blue("Status"),
    ],
    style: {
      head: [],
      border: [],
    },
    wordWrap: true,
    wrapOnWordBoundary: true,
  });
}

export function refreshDisplay(table: Table.Table) {
  printHeader();
  console.log("\n" + table.toString() + "\n");
}

export function updateProgressTable(
  table: Table.Table & { [index: number]: string[] },
  index: number,
  updates: TableUpdates,
  statusSpinner?: Ora
) {
  Object.entries(updates).forEach(([key, value]) => {
    switch (key) {
      case "status":
        table[index][1] = value;
        break;
      case "subLinks":
        table[index][2] = value;
        break;
      case "progress":
        table[index][3] = value;
        break;
      case "emailsFound":
        table[index][4] = value;
        break;
      case "lastUpdate":
        table[index][5] = value;
        break;
    }
  });
  refreshDisplay(table);
  console.log(""); // Add space for status spinner
}
