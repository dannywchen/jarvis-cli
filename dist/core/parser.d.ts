export interface ParsedDocument {
    title: string;
    sourcePath: string;
    fileType: 'pdf' | 'markdown' | 'text';
    rawText: string;
    sections: Array<{
        title: string;
        content: string;
    }>;
    wordCount: number;
}
/**
 * Ingests and parses any PDF, Markdown, or plain text document.
 */
export declare function parseDocument(filePath: string): Promise<ParsedDocument>;
