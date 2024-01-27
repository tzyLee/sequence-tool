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