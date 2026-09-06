import fs from 'node:fs/promises';
import path from 'node:path';
import pdf from 'pdf-parse';
/**
 * Normalizes and cleans raw text extracted from documents.
 */
function cleanText(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\t/g, '  ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[^\S\r\n]{2,}/g, ' ')
        .trim();
}
/**
 * Splits extracted document text into logical semantic sections.
 */
function splitIntoSections(rawText, fallbackTitle) {
    const lines = rawText.split('\n');
    const sections = [];
    let currentTitle = 'Introduction';
    let currentLines = [];
    const headingPattern = /^(?:#+\s*|CHAPTER\s+\d+|SECTION\s+\d+|[A-Z0-9.\-_ ]{4,40}:|[0-9]+\.\s+[A-Z])(.*)$/i;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (currentLines.length > 0)
                currentLines.push('');
            continue;
        }
        const match = trimmed.match(headingPattern);
        const looksLikeHeading = match || (trimmed.length < 55 && /^[A-Z][A-Za-z0-9 ,:'"()/-]{2,50}$/.test(trimmed) && !trimmed.endsWith('.'));
        if (looksLikeHeading && currentLines.length > 4) {
            const content = currentLines.join('\n').trim();
            if (content.length > 80) {
                sections.push({
                    title: currentTitle,
                    content,
                });
                currentTitle = trimmed.replace(/^#+\s*/, '').replace(/:$/, '').trim();
                currentLines = [];
                continue;
            }
        }
        currentLines.push(line);
    }
    if (currentLines.length > 0) {
        const content = currentLines.join('\n').trim();
        if (content.length > 0) {
            sections.push({
                title: currentTitle || fallbackTitle,
                content,
            });
        }
    }
    if (sections.length === 0) {
        sections.push({
            title: fallbackTitle,
            content: rawText,
        });
    }
    return sections;
}
/**
 * Ingests and parses any PDF, Markdown, or plain text document.
 */
export async function parseDocument(filePath) {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    try {
        await fs.access(resolvedPath);
    }
    catch {
        throw new Error(`File not found: ${resolvedPath}`);
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const baseName = path.basename(resolvedPath, ext);
    const formattedTitle = baseName
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    let rawText = '';
    let fileType = 'text';
    if (ext === '.pdf') {
        fileType = 'pdf';
        const buffer = await fs.readFile(resolvedPath);
        const pdfData = await pdf(buffer);
        rawText = pdfData.text || '';
    }
    else if (ext === '.md' || ext === '.markdown') {
        fileType = 'markdown';
        rawText = await fs.readFile(resolvedPath, 'utf-8');
    }
    else {
        fileType = 'text';
        rawText = await fs.readFile(resolvedPath, 'utf-8');
    }
    const cleaned = cleanText(rawText);
    if (!cleaned || cleaned.length < 20) {
        throw new Error(`The document at "${resolvedPath}" appears to be empty or unreadable.`);
    }
    const sections = splitIntoSections(cleaned, formattedTitle);
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    return {
        title: formattedTitle,
        sourcePath: resolvedPath,
        fileType,
        rawText: cleaned,
        sections,
        wordCount,
    };
}
