// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

type EditOption = { undoStopAfter: boolean, undoStopBefore: boolean }
type SequenceGen = Iterator<number, number, number>;
type StepFunction = (prev: number, index: number) => any;
type Formatter = (n: number) => string;
interface SequenceGenConstructor {
	new(init: number, stepFunc: StepFunction): SequenceGen;
}

const formatPrompt = 'format: [[fillChar][align][width][.prec][spec] ","][init]["," [expr]]'

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand(
		"sequence.insertSequence",
		async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage("Active editor not found!");
				return;
			}

			let editMade = false;
			const initialSelections = [...editor.selections].sort(sortSelection);
			const sequenceSpec = await vscode.window.showInputBox({
				// title: 'Enter sequence command',
				placeHolder: formatPrompt,
				async validateInput(value) {
					let [gen, fmt, msg] = parseCommand(value);
					if (!gen) {
						// clear previews when gen == null
						gen = new IndexSequenceGen(0, () => '');
					}
					// When the inputbox is active, the previews cannot be clear with 'undo' command
					// the text in the inputbox would be undoed instead
					await insertSequence(editor, initialSelections, gen, fmt, { undoStopBefore: !editMade, undoStopAfter: false }, true, editMade);
					editMade = true;
					return msg;
				}
			});

			if (sequenceSpec) {
				const [gen, fmt, _] = parseCommand(sequenceSpec);
				if (gen) {
					await vscode.commands.executeCommand('undo')
					await insertSequence(editor, initialSelections, gen, fmt, {
						undoStopBefore: false,
						undoStopAfter: true
					}, false);
				}
			} else {
				await vscode.commands.executeCommand('undo')
			}
		}
	);

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }


function parseCommand(v: string): [SequenceGen | null, Formatter, vscode.InputBoxValidationMessage | string] {
	let formatter = (n: number) => n.toString().replace(/[\r\n]/g, '');
	if (!v) {
		// initial empty input won't reach here,
		// clear the previews after input box is empty
		return [null, formatter, { message: 'Input is empty', severity: vscode.InputBoxValidationSeverity.Info }];
	}
	const match = (/^(?:(?:(?:(?<fillChar>(?!\.)[\D0])(?<align>[<>])?)?(?<width>[1-9]\d*))?(?:\.(?<precision>\d+))?(?:(?:(?<spec>[bodhxHXfc])|(?:b(?<base>\d+))))?,)?(?:(?<init>[+-]?(?:\d+|\d*\.\d+|\d+\.\d*)(?:[Ee][+-]?\d+)?)?(?:,(?<expr>.+))?)?$/).exec(v);
	let init = 0;
	let stepFunc = (p: number, i: number) => p + 1;
	let Constructor: SequenceGenConstructor = PrevSequenceGen;
	if (!match) {
		return [new Constructor(init, stepFunc), formatter, { message: `The command does not match the ${formatPrompt}`, severity: vscode.InputBoxValidationSeverity.Warning }]
	}
	let formatCmd = 'default'
	let initCmd = '0'
	let exprCmd = '(p, i) => p+1'
	// groups is not null if there exists any named group
	const groups = match.groups!;
	// base conversion: only supports integer
	if (groups.spec != 'c' && groups.spec != 'f' && groups.spec) {
		let base = 10;
		const gbase = parseInt(groups.base)
		switch (groups.spec) {
			case 'b': base = 2; break;
			case 'o': base = 8; break;
			case 'd': base = 10; break;
			case 'X': case 'H': case 'x': case 'h': base = 16; break;
			default: if (gbase) {
				base = gbase;
			}
		}
		if (groups.spec == groups.spec.toUpperCase()) {
			// For X and H
			formatter = (n: number) => Math.trunc(n).toString(base).toUpperCase()
		} else {
			formatter = (n: number) => Math.trunc(n).toString(base)
		}
		formatCmd = `base=${base}`
	}
	// charcode
	if (groups.spec == 'c') {
		formatter = (n: number) => String.fromCharCode(n).replace(/[\r\n]/g, '')
		formatCmd = `spec=char`
	}
	// precision: only supports decimal floating point
	if (groups.spec == 'f') {
		let precision = 6;
		const gprec = parseInt(groups.precision)
		if (gprec) {
			precision = gprec;
		}
		formatter = (n: number) => n.toFixed(precision)
		formatCmd = `precision=${precision}f`
	}
	// padding occurs after the number is formatted
	if (groups.width) {
		let padLeft = true;
		let fill = ' ';
		let width: number | undefined = undefined;
		if (groups.align == '<') {
			padLeft = false;
		}
		if (groups.width) {
			width = parseInt(groups.width)
			fill = groups.fillChar || ' '
			const prevFormatter = formatter;
			formatter = (n: number) => padLeft ? prevFormatter(n).padStart(width!!, fill) : prevFormatter(n).padEnd(width!!, fill)
		}
		const padCmd = `${fill}${padLeft ? '>' : '<'}${width !== undefined ? width : ''}`
		formatCmd = formatCmd ? `${padCmd},${formatCmd}` : padCmd
	}
	// 2's complement
	if (groups.spec == 'b' && groups.width && groups.fillChar == '0' && groups.align != '<') {
		const bitwidth = parseInt(groups.width)
		const N = 2 ** bitwidth;
		formatter = (n: number) => {
			let nint = Math.trunc(n);
			let fillChar = '0';
			if (nint < 0) {
				nint = N + nint;
				fillChar = '1'
			}
			return nint.toString(2).padStart(bitwidth, fillChar)
		}
		formatCmd = `0>${groups.width},2's`
	}
	try {
		if (groups.expr) {
			stepFunc = eval(`(function (p,i) { return (${groups.expr}); })`)
			exprCmd = `(p,i) => ${groups.expr}`
		}
		if (groups.init) {
			if (groups.init) {
				init = parseFloat(groups.init);
				initCmd = groups.init
			}
		} else {
			if (groups.expr && !/\bp\b/.test(groups.expr)) {
				// Use index gen if there's no inital value and the expression does not contain p
				init = stepFunc(0, 0);
				initCmd = init.toString()
				Constructor = IndexSequenceGen;
			}
		}
	} catch (e: any) {
		return [null, formatter, { message: `Invalid function string: "${e?.message ?? v}"`, severity: vscode.InputBoxValidationSeverity.Warning }]
	}

	return [new Constructor(init, stepFunc), formatter, { message: `Command: [${formatCmd}],[${initCmd}],[${exprCmd}]`, severity: vscode.InputBoxValidationSeverity.Info }]
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
			editor.visibleRanges.forEach((r) => { visibleRange = visibleRange.union(r) });
		}
		// always insert at the end of selections
		const len = initialSelections.length;
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
				let r = new vscode.Range(sel.start.translate(0, +dChar), sel.end)
				if (sel.isEmpty) {
					// If the selection is empty, it is in cursor mode
					// The selection is a zero-size selection and moves after insert
					r = r.with(initSel.end, sel.end)
				}
				builder.delete(r)
			}

			// `delete` + `insert` should be equal to one `replace` call
			// But when two selections overlap, vscode automatically merges them (which reduces the total number of selections),
			// so here we separate delete and insert calls instead.
			builder.insert(sel.end, (val === undefined || val === null) ? '' : fmt(val))
		}
	}, option)
}

class PrevSequenceGen implements Iterator<number, number, number> {
	constructor(private value: number, private stepFunc: StepFunction) {
	}
	// Calculates next value based on the previous value
	public next(index: number): IteratorResult<number> {
		const value = this.value;
		this.value = this.stepFunc(this.value, index);
		return {
			done: false,
			value
		}
	}
}
class IndexSequenceGen implements Iterator<number, number, number> {
	constructor(private value: number, private stepFunc: StepFunction) {
	}
	// Calculates next value based on the index
	public next(index: number): IteratorResult<number> {
		this.value = this.stepFunc(this.value, index);
		return {
			done: false,
			value: this.value
		}
	}
}


function length(p: vscode.Selection) {
	return p.end.character - p.start.character
}