const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs = require('fs');
const path = require('path');

class DocxGenerator {
    constructor(templatePath) {
        this.templatePath = templatePath;
        if (!fs.existsSync(this.templatePath)) {
            throw new Error(`Template not found at ${this.templatePath}`);
        }
    }

    generate(data, outputPath) {
        // Load the docx file as binary content
        const content = fs.readFileSync(this.templatePath, 'binary');

        // Initialize PizZip with the binary content
        const zip = new PizZip(content);

        // Initialize Docxtemplater
        let doc;
        try {
            doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
            });
        } catch (error) {
            throw new Error(`Docxtemplater init error: ${error.message}`);
        }

        // Map data keys to uppercase placeholders used in template (like {{PROJECT_NAME}})
        const renderData = {};
        for (const [key, val] of Object.entries(data)) {
            renderData[key.toUpperCase()] = typeof val === 'string' ? val : String(val);
        }

        // Render the document 
        try {
            doc.render(renderData);
        } catch (error) {
            console.error("Docxtemplater Render Error:", error);
            throw error;
        }

        // Generate the new docx file
        const buf = doc.getZip().generate({ type: 'nodebuffer' });

        // Ensure output directory exists
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        // Write to file
        fs.writeFileSync(outputPath, buf);
        return outputPath;
    }
}

module.exports = DocxGenerator;
