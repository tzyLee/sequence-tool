# Sequence Tool

[Sequence Tool]() inserts sequences with live preview in Visual Studio Code.

## Features

<p align="center">
<img src="res/icon.png" alt="showcase" width="128px">
</p>

### Insert Custom Sequence With Multi-cursors - `sequence-tool.insertSequence`

Windows/Linux: <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>0</kbd>,
Mac: <kbd>Cmd</kbd> + <kbd>Alt</kbd> + <kbd>0</kbd>

#### Linebreak insertion is not supported, use `sequence-tool.insertNLinesAfter` instead.

Command Syntax: `[[[fillChar]align][width][.prec][spec]],[init],[expr]` (A subset of Python's format specification mini-language).

Can contain only the `[init]` field, or separates the possibly empty field with `,`.

| Field        | Definition                                                                                         |
| :----------- | :------------------------------------------------------------------------------------------------- |
| **fillChar** | Character used to pad to the given width. The alignment must be specified excpet for `fillChar=0`. |
| **align**    | `>` for right-align and `<` for left-align within the available space.                             |
| **.prec**    | The number of digits should be displayed after the decimal point for spec `f`.                     |
| **spec**     | How the value should be displayed (see below).                                                     |
| **init**     | Initial value of sequence, defaults to 0 (see below).                                              |
| **expr**     | The function `(p, i) => expr` generates the next value of the sequence. (see below)                |

#### Spec

Can be one of the followings. Non-numeric values will be filtered when using numeric specs.

| Field                   | Definition                                                                 |
| :---------------------- | :------------------------------------------------------------------------- |
| **b**                   | Binary number.                                                             |
| **o**                   | Octal number.                                                              |
| **d**                   | Decimal integer number.                                                    |
| **h**,**x**,**H**,**X** | Hexadecimal number, use **H** or **X** for uppercase digits.               |
| **f**                   | Decimal fractional numbers.                                                |
| **c**                   | Converts to single Unicode character.                                      |
| **b\d+**                | Convert to other bases, can be 2 to 36 (For example: **b36** for base 36). |

#### Init

| Type                      | Definition                                      |
| :------------------------ | :---------------------------------------------- |
| **Number**                | Number literal, can be fractional.              |
| **English Letter**        | Generates the spreadsheet column name sequence. |
| **JavaScript Expression** | Any valid javascript expressions.               |

#### Expr

Creates the function `(p, i) => expr`

The default inital value won't be used if the **init** is unspecified and the **expr** does not contain **p**.

| Parameter | Definition                                                  |
| :-------- | :---------------------------------------------------------- |
| **p**     | The previous value of the sequence, initalized by **init**. |
| **i**     | Zero-based index of the sequence.                           |

---

### Insert N Lines After Cursors - `sequence-tool.insertNLinesAfter`

Inserts N lines after the cursor(s). Creates N new cursors on each line inserted.

---

### Use Previous Saved Commands - `sequence-tool.useCommand`

Use a predefined command in settings `sequence-tool.customCommands`.

## Example

### 1. _Basic Usage_

`42` (initial value)

### 2. Padding

`#<5,42`

### 3. Base conversion

`07b,-6` (2's complement for binary number with 0 padding)

`c,65` (ASCII/unicode)

### 4. Other Practical Use

`#>5,,''` (repeated characters)

`,,'123'[(i/5|0)%3]` (cyclic and repeated)

`AZ` (spreadsheet column names)

### 5. Custom Sequence

`,1,p*2` (p represents previous value, just like `Array.prototype.reduce`)

`,,'abc'[i%3]` (i is 0-based index)

`,1,p*(i+1)` (factorial, p and i can be used together)

`d,,(((1+Math.sqrt(5))/2)**i-((1-Math.sqrt(5))/2)**i)/Math.sqrt(5)` (Fibonacci sequence)

`,1,(4-6/(i+2))*p` (Catalan number, alternatively `,,(f=>f(f))(c=>x=>x?(4+6/~x)*(f=>f(f))(c)(x-1):1)(i)`)

`` ,1,`${p}`.replace(/(.)\1*/g, m=>`${m.length}${m.substring(0, 1)}`)  `` (look and say sequence)

## Extension Settings

This extension contributes the following settings:

- `sequence-tool.customCommands`: Stores your frequently used command here. These commands will appear in `sequence-tool.useCommand` command, and can be invoked by keybindings.

### Example

| Name        | Value              |
| :---------- | :----------------- |
| **Catalan** | `,1,(4-6/(i+2))*p` |

## Keybindings

Commands can be invoked by custom keybindings.

`Preferences: Open Keyboard Shortcuts (JSON)`

```json
// Execute a command (factorial) on keypress
{
   "key": "ctrl+alt+,",
   "command": "sequence-tool.insertSequence",
   "args": { "command": ",1,p*(i+1)" }
},
// Pick a preconfigured command (Catalan numbers) on keypress
{
  "key": "ctrl+alt+.",
  "command": "sequence-tool.useCommand",
  "args": { "name": "Catalan" }
}
```

## Release Notes

See [CHANGELOG.md](CHANGELOG.md).

## Special Thanks!

- The live preview is based on [tomoki1207/vscode-input-sequence](https://github.com/tomoki1207/vscode-input-sequence).
