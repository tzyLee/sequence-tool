// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

type EditOption = { undoStopAfter: boolean, undoStopBefore: boolean }
type SequenceGen = Iterator<number, number, number>;
type StepFunction = (prev: number, index: number) => any;
interface SequenceGenConstructor {
	new(init: number, stepFunc: StepFunction): SequenceGen;
}

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
			const initialLengths = [...editor.selections].sort(sortSelection).map(s => length(s));
			// const sequenceSpec = await vscode.window.showInputBox({
			// 	title: 'Enter sequence command',
			// 	placeHolder: 'format: [initialValue][,[(p: prev, i: index) expr]',
			// 	async validateInput(value) {
			// 		let [gen, msg] = getGenerator(value);
			// 		if (!gen) {
			// 			// clear previews when gen == null
			// 			gen = new IndexSequenceGen(0, () => '');
			// 		}
			// 		if (editMade) {
			// 			await vscode.commands.executeCommand('undo')
			// 		}
			// 		await insertSequence(editor, initialLengths, gen, { undoStopBefore: !editMade, undoStopAfter: false }, true);
			// 		editMade = true;
			// 		return msg;
			// 	}
			// });

			const input = vscode.window.createInputBox();
			input.title = 'Enter sequence command';
			input.placeholder = 'format: [initialValue][,[(p: prev, i: index) expr]';

			let sequenceSpec = await showCustomInput({ title: 'Enter sequence command', placeHolder: 'format: [initialValue][,[(p: prev, i: index) expr]' });




			if (sequenceSpec) {
				const [gen, _] = getGenerator(sequenceSpec);
				if (gen) {
					await vscode.commands.executeCommand('undo')
					await insertSequence(editor, initialLengths, gen, {
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


function getGenerator(v: string): [SequenceGen | null, vscode.InputBoxValidationMessage | string] {
	if (!v) {
		// initial empty input won't reach here,
		// clear the previews after input box is empty
		return [null, { message: 'Input is empty', severity: vscode.InputBoxValidationSeverity.Info }];
	}
	const matchResult = v.match(/^([+-]?(?:\d+|\d*\.\d+|\d+\.\d*)(?:[Ee][+-]?\d+)?)(?:,(.*))?$/);
	let init = 0;
	let stepFunc = (p: number, i: number) => p + 1;
	let Constructor: SequenceGenConstructor = PrevSequenceGen;
	try {
		if (matchResult) {
			init = parseFloat(matchResult[1]);
			if (matchResult[2]) {
				stepFunc = eval(`(function (p,i) { return (${matchResult[2]}); })`)
			}
		} else {
			stepFunc = eval(`(function (p,i) { return (${v}); })`)
			if (!/\bp\b/.test(v)) {
				init = stepFunc(0, 0);
				Constructor = IndexSequenceGen;
			}
		}
	} catch (e: any) {
		return [null, { message: e?.message ?? `Invalid function string "${v}"`, severity: vscode.InputBoxValidationSeverity.Warning }]
	}
	return [new Constructor(init, stepFunc), '']
}

function sortSelection(a: vscode.Selection, b: vscode.Selection): number {
	return (
		a.anchor.line - b.anchor.line || a.anchor.character - b.anchor.character
	);
}

async function insertSequence(editor: vscode.TextEditor, initialLengths: number[], gen: SequenceGen, option: EditOption, isPreview: boolean) {
	let res = await editor.edit((builder) => {
		const selections = [...editor.selections].sort(sortSelection);
		let visibleRange = editor.visibleRanges[0];
		if (isPreview) {
			editor.visibleRanges.forEach((r) => { visibleRange = visibleRange.union(r) });
		}
		console.log('Before:')
		selections.forEach((s) => console.log(`start: line[${s.start.line}]char[${s.start.character}], end: line[${s.end.line}]char[${s.end.character}]`))
		// always insert at the end of selections
		initialLengths.forEach((dChar, i) => {
			let val = gen.next(i).value;
			if (isPreview && !visibleRange.contains(selections[i])) {
				// skip preview of invisible parts
				return;
			}
			// use replace to remove previous preview
			// (for undo command, vscode undos the active element,
			// in this case, the InputBox itself is undo'ed)

			// because the selection may move after insertion
			// the range start position is not initial start position
			builder.replace(new vscode.Range(selections[i].start.translate(0, +dChar), selections[i].end), (val === undefined || val === null) ? '' : val.toString())
			// builder.insert(selections[i].end, (val === undefined || val === null) ? '' : val.toString())
			// TODO: the selection is replaced when two selections are next to each other
		})
	}, option)
	console.log('After:')
	const newSelection = [...editor.selections].sort(sortSelection)
	newSelection.forEach((s) => console.log(`start: line[${s.start.line}]char[${s.start.character}], end: line[${s.end.line}]char[${s.end.character}]`))
	console.log('end')
	return res
}


class PrevSequenceGen implements Iterator<number, number, number> {
	constructor(private value: number, private stepFunc: StepFunction) {
	}

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

// src/vs/platform/quickinput/browser/quickInput.ts
function
	showCustomInput(options: vscode.InputBoxOptions = {}, token?: vscode.CancellationToken): Promise<string | undefined> {
	return new Promise<string | undefined>((resolve) => {
		if (token?.isCancellationRequested) {
			resolve(undefined);
			return;
		}
		const input = vscode.window.createInputBox();
		// const validateInput = options.validateInput || (() => <Promise<undefined>>Promise.resolve(undefined));


		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage("Active editor not found!");
			return;
		}

		let editMade = false;
		const initialLengths = [...editor.selections].sort(sortSelection).map(s => length(s));
		const validateInput = async (value: string) => {
			let [gen, msg] = getGenerator(value);
			if (!gen) {
				// clear previews when gen == null
				gen = new IndexSequenceGen(0, () => '');
			}
			input.enabled = false;
			if (editMade) {
				// editor.revealRange(editor.visibleRanges[0], vscode.TextEditorRevealType.Default)
				// await vscode.commands.executeCommand('undo')
			}
			await insertSequence(editor, initialLengths, gen, { undoStopBefore: !editMade, undoStopAfter: false }, true);
			editMade = true;
			input.enabled = true;
			return msg;
		}

		// function debounce<T>(func: vscode.Event<T>, timeout: number = 200) {
		// 	let timeoutID: NodeJS.Timeout;
		// 	return function () {
		// 		timeoutID && clearTimeout(timeoutID);
		// 		timeoutID = setTimeout(function () {
		// 			func.apply(scope, Array.prototype.slice.call(args));
		// 		}, timeout);
		// 	}
		// }


		// const onDidValueChange = vscode.Event.debounce(input.onDidChangeValue, (last, cur) => cur, 100);
		// const onDidValueChange = debounce(input.onDidChangeValue, (last, cur) => cur, 100);
		let validationValue = options.value || '';
		let validation = Promise.resolve(validateInput(validationValue));
		const disposables = [
			input,
			// onDidValueChange((value: string) => {
			input.onDidChangeValue((value: string) => {
				if (value !== validationValue) {
					validation = Promise.resolve(validateInput(value));
					validationValue = value;
				}
				validation.then(result => {
					if (value === validationValue) {
						input.validationMessage = result;
					}
				});
			}),
			input.onDidAccept(() => {
				const value = input.value;
				if (value !== validationValue) {
					validation = Promise.resolve(validateInput(value));
					validationValue = value;
				}
				validation.then(result => {
					if (!result || (!isString(result) && result.severity !== vscode.InputBoxValidationSeverity.Error)) {
						resolve(value);
						input.hide();
					} else if (value === validationValue) {
						input.validationMessage = result;
					}
				});
			}),
			token?.onCancellationRequested(() => {
				input.hide();
			}),
			input.onDidHide(() => {
				while (disposables.length) {
					const x = disposables.pop();
					x?.dispose();
				}
				resolve(undefined);
			}),
		];

		input.title = options.title;
		input.value = options.value || '';
		input.valueSelection = options.valueSelection;
		input.prompt = options.prompt;
		input.placeholder = options.placeHolder;
		input.password = !!options.password;
		// input.ignoreFocusOut = !!options.ignoreFocusLost;
		input.show();
	});
}

function isString(data: unknown): data is string {
	return typeof data === 'string';
};