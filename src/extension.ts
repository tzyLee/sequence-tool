import * as vscode from "vscode";
import { formatPrompt } from "./parser";
import { CommandHandler, insertNLines } from "./handler";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(vscode.commands.registerCommand(
		"sequence-tool.insertSequence",
		async (...args) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage("Active editor not found!");
				return;
			}
			const handler = new CommandHandler(editor);
			let command = null;
			if (args.length === 0 || !(args[0].command)) {
				command = await vscode.window.showInputBox({
					placeHolder: formatPrompt,
					validateInput: handler.doPreview.bind(handler)
				});
			} else {
				command = args[0].command;
			}

			await handler.execute(command);
		}
	));

	context.subscriptions.push(vscode.commands.registerCommand(
		'sequence-tool.insertNLinesAfter',
		async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage("Active editor not found!");
				return;
			}

			const nlines = await vscode.window.showInputBox({
				placeHolder: 'Number of line(s) to insert',
				async validateInput(value) {
					if (/^\s*\d+\s*$/.test(value)) {
						const limit = parseFloat(vscode.workspace.getConfiguration().get("editor.multiCursorLimit") ?? 'Infinity');
						if (parseInt(value) > limit) {
							return { message: `The value exceeds \`editor.multiCursorLimit\`=${limit}`, severity: vscode.InputBoxValidationSeverity.Warning };
						}
						return '';
					}
					return { message: 'Should be a nonnegative integer', severity: vscode.InputBoxValidationSeverity.Warning };
				}
			});
			if (nlines) {
				await insertNLines(nlines, editor);
			}
		}));

	context.subscriptions.push(vscode.commands.registerCommand(
		"sequence-tool.useCommand",
		async (...args) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage("Active editor not found!");
				return;
			}

			const customCommands = vscode.workspace.getConfiguration().get("sequence-tool.customCommands") as CustomCommandConfig;
			const handler = new CommandHandler(editor);

			let command = '';
			if (args.length > 0 && args[0]?.name && customCommands[args[0].name]) {
				command = customCommands[args[0].name];
			}

			if (!command) {
				const options = Object.keys(customCommands).map(name => ({
					label: name,
					description: customCommands[name]
				} as vscode.QuickPickItem));

				let placeHolder = 'Choose Command';
				if (options.length === 0) {
					if (!vscode.workspace.isTrusted) {
						placeHolder = 'No settings from untrusted workspaces are applied.';
					} else {
						placeHolder = "Add new commands in setting 'sequence-tool.customCommands'.";
					}
				}

				const pickedOption = await vscode.window.showQuickPick(options, {
					matchOnDescription: true,
					matchOnDetail: true,
					placeHolder: placeHolder,
					async onDidSelectItem(item: vscode.QuickPickItem) {
						if (!item?.description) {
							return;
						}
						await handler.doPreview(item.description);
					}
				});

				command = pickedOption?.description ?? '';
			}
			await handler.execute(command);
		}));
}

// this method is called when your extension is deactivated
export function deactivate() { }
