// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

type EditOption = { undoStopAfter: boolean, undoStopBefore: boolean; };
// The sequence could be non-numeric due to 'eval'
type SequenceGen = Iterator<unknown, unknown, unknown>;
type StepFunction = (prev: unknown, index: number) => unknown;
type Formatter = (n: unknown) => string;
interface SequenceGenConstructor {
	new(init: unknown, stepFunc: StepFunction): SequenceGen;
}
interface CustomCommandConfig {
	[key: string]: string;
}

const sequenceInsertionDecorationType = vscode.window.createTextEditorDecorationType({
	overviewRulerColor: 'blue',
	overviewRulerLane: vscode.OverviewRulerLane.Right,
	backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
	borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
});

const formatPrompt = 'format: [[fillChar][align][width][.prec][spec] ","][init]["," [expr]]';

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
						return '';
					}
					return { message: 'Should be a nonnegative integer', severity: vscode.InputBoxValidationSeverity.Warning };
				}
			});
			if (nlines) {
				const nLinesToInsert = parseInt(nlines);
				let eol = '\n';
				switch (editor.document.eol) {
					case vscode.EndOfLine.CRLF:
						eol = '\r\n';
						break;
					case vscode.EndOfLine.LF:
						break;
				}
				eol = eol.repeat(nLinesToInsert);
				await editor.edit((builder) => {
					editor.selections.forEach(selection => {
						builder.insert(selection.end, eol);
					});
				});
				let newSel = [...editor.selections];
				for (const oldSel of editor.selections) {
					for (let i = oldSel.end.line - nLinesToInsert + 1, end = oldSel.end.line; i < end; i++) {
						newSel.push(new vscode.Selection(i, 0, i, 0));
					}
				}
				editor.selections = newSel;
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

class CommandHandler {
	private editMade: boolean = false;
	private initialSelections: vscode.Selection[];
	constructor(private editor: vscode.TextEditor) {
		this.initialSelections = [...editor.selections].sort(sortSelection);
	}

	async doPreview(command: string) {
		let [gen, fmt, msg] = parseCommand(command);
		if (!gen) {
			// clear previews when gen == null
			gen = new IndexSequenceGen(0, () => '');
		}
		// When the inputbox is active, the previews cannot be clear with 'undo' command
		// the text in the inputbox would be undoed instead
		await insertSequence(this.editor, this.initialSelections, gen, fmt, { undoStopBefore: !this.editMade, undoStopAfter: false }, true, this.editMade);
		highlightPreview(this.editor, this.initialSelections);
		this.editMade = true;
		return msg;
	}

	private async clearPreview() {
		if (!this.editMade) {
			return;
		}
		// Clear preview
		await vscode.commands.executeCommand('undo');
		this.editor.setDecorations(sequenceInsertionDecorationType, []);
		// Make sure the undo only happens once
		this.editMade = false;
	}

	async execute(command: string) {
		// Attempt to clear preview even if the command is not valid
		await this.clearPreview();
		if (!command) {
			return;
		}
		const [gen, fmt, _] = parseCommand(command);
		if (gen) {
			await insertSequence(this.editor, this.initialSelections, gen, fmt, {
				undoStopBefore: false,
				undoStopAfter: true
			}, false);
		}
	}
}


function parseCommand(v: string): [SequenceGen | null, Formatter, vscode.InputBoxValidationMessage | string] {
	let formatter = (n: unknown) => n !== null && n !== undefined ? n.toString().replace(/[\r\n]/g, '') : '';
	if (!v) {
		// initial empty input won't reach here,
		// clear the previews after input box is empty
		return [null, formatter, { message: 'Input is empty', severity: vscode.InputBoxValidationSeverity.Info }];
	}
	const match = (/^(?:(?:(?<fillChar>.)(?<align>[<>]))?(?<fillZero>0)?(?<width>[1-9]\d*)?(?:\.(?<precision>\d+))?(?<spec>[bodhxHXfc])?(?:b(?<base>\d+))?,)?(?:(?<init>[^,]+)?(?:,(?<expr>.+))?)?$/).exec(v);
	let init: any = 0;
	let stepFunc = (p: unknown, i: number) => isNumber(p) ? p + 1 : 0;
	let constructor: SequenceGenConstructor = PrevSequenceGen;
	if (!match) {
		return [new constructor(init, stepFunc), formatter, { message: `The command does not match the ${formatPrompt}`, severity: vscode.InputBoxValidationSeverity.Warning }];
	}
	let formatCmd = 'default';
	let initCmd = '0';
	let exprCmd = '(p, i) => p+1';
	let inferredPrecision = 0;
	// groups is not null if there exists any named group
	const groups = match.groups!;

	try {
		if (groups.expr) {
			stepFunc = (0, eval)(`(function (p,i) { return (${groups.expr}); })`);
			exprCmd = `(p,i) => ${groups.expr}`;
			// Infer precision from step
			if ((!groups.spec || groups.spec === 'f' && !groups.precision)) {
				for (const m of groups.expr.matchAll(/\bp[+-](?:\d*\.(?<frac1>\d+)|\d+\.(?<frac2>\d*))\b/g)) {
					if (m?.groups) {
						groups.spec = 'f';
						inferredPrecision = Math.max(inferredPrecision, (m.groups?.frac1?.length ?? m.groups?.frac2?.length ?? 0));
					}
				}
			}
		}
		if (groups.init) {
			const numMatch = /^[+-]?(?:\d+|\d*\.(?<frac1>\d+)|\d+\.(?<frac2>\d*))(?:[Ee][+-]?\d+)?$/.exec(groups.init);
			if (numMatch) {
				init = parseFloat(groups.init);
				initCmd = groups.init;
				// Infer precision from initial value
				if ((!groups.spec || groups.spec === 'f' && !groups.precision)) {
					// numMatch can match a non-fraction number
					if (numMatch?.groups?.frac1 || numMatch?.groups?.frac2) {
						groups.spec = 'f';
						inferredPrecision = Math.max(inferredPrecision, (numMatch.groups?.frac1?.length ?? numMatch.groups?.frac2?.length ?? 0));
					}
				}
			}
			else if (/^[a-zA-Z]+$/.test(groups.init)) {
				init = fromSpreadSheet(groups.init);
				initCmd = `letter"${groups.init}"`;
				formatter = (n: unknown) => isNumber(n) ? toSpreadSheet(n, /^[a-z]$/.test(groups.init[0])) : '';
			}
			else {
				try {
					init = (0, eval)(groups.init);
					initCmd = `expr"${groups.init}"`;
				} catch (e) {
					if (groups.init.length === 1) {
						init = groups.init.codePointAt(0);
						initCmd = `unicode"${groups.init}"`;
					} else {
						initCmd = `unk"${groups.init}"=0`;
					}
				}
			}
		} else {
			if (groups.expr && !/\bp\b/.test(groups.expr)) {
				// Use index gen if there's no inital value and the expression does not contain p
				init = stepFunc(0, 0);
				initCmd = init.toString();
				constructor = IndexSequenceGen;
			}
		}
	} catch (e: any) {
		return [null, formatter, { message: `Command: [${formatCmd}] , [${initCmd}] , [${exprCmd}] Invalid function string: "${e?.message ?? v}"`, severity: vscode.InputBoxValidationSeverity.Warning }];
	}

	// base conversion: only supports integer
	if (groups.spec !== 'c' && groups.spec !== 'f' && groups.spec || groups.base) {
		let base = 10;
		const gbase = parseInt(groups.base);
		switch (groups.spec) {
			case 'b': base = 2; break;
			case 'o': base = 8; break;
			case 'd': base = 10; break;
			case 'X': case 'H': case 'x': case 'h': base = 16; break;
			default: if (gbase) {
				base = gbase;
			}
		}
		base = Math.max(2, Math.min(36, base));
		if (groups.spec && groups.spec === groups.spec.toUpperCase()) {
			// For X and H
			formatter = (n: unknown) => isNumber(n) ? Math.trunc(n).toString(base).toUpperCase() : '';
		} else {
			formatter = (n: unknown) => isNumber(n) ? Math.trunc(n).toString(base) : '';
		}
		formatCmd = `base=${base}`;
	}
	// charcode
	if (groups.spec === 'c') {
		formatter = (n: unknown) => isNumber(n) ? String.fromCodePoint(n).replace(/[\r\n]/g, '') : '';
		formatCmd = `spec=char`;
	}
	// precision: only supports decimal floating point
	if (groups.spec === 'f') {
		let precision = inferredPrecision || 6;
		const gprec = parseInt(groups.precision);
		if (gprec) {
			precision = gprec;
		}
		formatter = (n: unknown) => isNumber(n) ? n.toFixed(precision) : '';
		formatCmd = `precision=${precision}f`;
	}
	if (groups.fillZero && !groups.fillChar) {
		groups.fillChar = groups.fillZero;
	}
	// padding occurs after the number is formatted
	if (groups.width) {
		let padLeft = true;
		let fill = ' ';
		let width: number | undefined = undefined;
		if (groups.align === '<') {
			padLeft = false;
		}
		if (groups.width) {
			width = parseInt(groups.width);
			fill = groups.fillChar || ' ';
			const prevFormatter = formatter;
			formatter = (n: unknown) => padLeft ? prevFormatter(n).padStart(width!!, fill) : prevFormatter(n).padEnd(width!!, fill);
		}
		const padCmd = `${fill}${padLeft ? '>' : '<'}${width !== undefined ? width : ''}`;
		formatCmd = formatCmd ? `${padCmd},${formatCmd}` : padCmd;
	}
	// 2's complement
	if (groups.spec === 'b' && groups.width && groups.fillChar === '0' && groups.align !== '<') {
		const bitwidth = parseInt(groups.width);
		const N = 2 ** bitwidth;
		formatter = (n: unknown) => {
			if (!isNumber(n)) {
				return '';
			}
			let nint = Math.trunc(n);
			let fillChar = '0';
			if (nint < 0) {
				nint = N + nint;
				fillChar = '1';
			}
			return nint.toString(2).padStart(bitwidth, fillChar);
		};
		formatCmd = `0>${groups.width},2's`;
	}
	return [new constructor(init, stepFunc), formatter, { message: `Command: [${formatCmd}] , [${initCmd}] , [${exprCmd}]`, severity: vscode.InputBoxValidationSeverity.Info }];
}

function sortSelection(a: vscode.Selection, b: vscode.Selection): number {
	return (
		a.anchor.line - b.anchor.line || a.anchor.character - b.anchor.character
	);
}

async function insertSequence(editor: vscode.TextEditor, initialSelections: vscode.Selection[], gen: SequenceGen, fmt: Formatter, option: EditOption, isPreview: boolean, deleteBeforeInsert: boolean = false) {
	return await editor.edit((builder) => {
		const selections = [...editor.selections].sort(sortSelection);
		let visibleRange = editor.visibleRanges[0];
		if (isPreview) {
			editor.visibleRanges.forEach((r) => { visibleRange = visibleRange.union(r); });
		}
		// always insert at the end of selections
		const len = initialSelections.length;
		let lastLine = -1;
		let curCharDelta = 0; // records the number of character delted so far on current line
		for (let i = 0; i < len; i++) {
			const initSel = initialSelections[i];
			const sel = selections[i];
			// Still calculates replacement even when the selection is out of preview range
			let val = gen.next(i).value;
			if (isPreview && !visibleRange.contains(sel)) {
				if (sel.start.isAfter(visibleRange.end)) {
					// The selections are sorted, so the for loop can stop after encountering the first selection outside the visible range
					break;
				}
				// skip preview of invisible parts
				continue;
			}

			if (deleteBeforeInsert) {
				let dChar = length(initSel);
				let r = new vscode.Range(sel.start.translate(0, +dChar), sel.end);
				// r.start !== initSel.end (not always equal)
				if (sel.isEmpty) {
					if (lastLine !== sel.start.line) {
						curCharDelta = 0;
					}
					// If the selection is empty, it is in cursor mode
					// The selection is a zero-size selection and moves after insert
					r = r.with(initSel.end.translate(0, +curCharDelta), sel.end);
					curCharDelta += r.end.character - r.start.character;
					lastLine = sel.start.line;
				}
				builder.delete(r);
			}

			// `delete` + `insert` should be equal to one `replace` call
			// But when two selections overlap, vscode automatically merges them (which reduces the total number of selections),
			// so here we separate delete and insert calls instead.
			builder.insert(sel.end, (val === undefined || val === null) ? '' : fmt(val));
		}
	}, option);
}

function highlightPreview(editor: vscode.TextEditor, initialSelections: vscode.Selection[]) {
	let lastLine = -1;
	let curCharDelta = 0; // records the number of character delted so far on current line
	const cursel = [...editor.selections].sort(sortSelection);
	let selectionsInRange = cursel.map((sel, i) => {
		const initSel = initialSelections[i];
		let dChar = length(initSel);
		// Same as above
		let r = new vscode.Range(sel.start.translate(0, +dChar), sel.end);
		if (sel.isEmpty) {
			if (lastLine !== sel.start.line) {
				curCharDelta = 0;
			}
			r = r.with(initSel.end.translate(0, +curCharDelta), sel.end);
			curCharDelta += r.end.character - r.start.character;
			lastLine = sel.start.line;
		}
		return r;
	});
	editor.setDecorations(sequenceInsertionDecorationType, selectionsInRange);
}

class PrevSequenceGen implements Iterator<unknown, unknown, unknown> {
	constructor(private value: unknown, private stepFunc: StepFunction) {
	}
	// Calculates next value based on the previous value
	public next(index: number): IteratorResult<unknown> {
		const value = this.value;
		this.value = this.stepFunc(this.value, index);
		return {
			done: false,
			value
		};
	}
}
class IndexSequenceGen implements Iterator<unknown, unknown, unknown> {
	constructor(private value: unknown, private stepFunc: StepFunction) {
	}
	// Calculates next value based on the index
	public next(index: number): IteratorResult<unknown> {
		this.value = this.stepFunc(this.value, index);
		return {
			done: false,
			value: this.value
		};
	}
}


function length(p: vscode.Selection) {
	return p.end.character - p.start.character;
}

function isNumber(n: unknown): n is number {
	return typeof n === 'number';
}

function fromSpreadSheet(s: string) {
	let ret = 0;
	s = s.toLowerCase();
	const n = s.length;
	for (let i = 0; i < n; i++) {
		ret = ret * 26 + (s.charCodeAt(i) - 96);
	}
	return ret;
}

function toSpreadSheet(n: number, lower: boolean = true) {
	let ret = '';
	// without n--, f(0) == 'A'
	// use n-- to make g(1) == 'A'
	n--;
	const offset = lower ? 97 : 65; // 'a' or 'A'
	for (; n >= 0; n = Math.floor(n / 26) - 1) {
		ret = String.fromCharCode(n % 26 + offset) + ret;
	}
	return ret;
}