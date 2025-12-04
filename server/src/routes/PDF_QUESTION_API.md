# PDF Question Answering API

This endpoint combines MinerU PDF parsing with agentic reading to answer questions about PDF documents.

## Endpoint

```
POST /pdf_question_stream
```

## Features

- **PDF Parsing**: Uses self-hosted MinerU to parse PDFs with formula, table, and OCR support
- **Agentic Reading**: Intelligently explores the parsed document to answer questions
- **Streaming Response**: Real-time progress updates via Server-Sent Events (SSE)
- **Caching**: Parsed PDFs are cached in MongoDB for faster subsequent queries
- **Multi-modal**: Can analyze both text and images within PDFs

## Request

### Content-Type
`multipart/form-data`

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | File | Yes | - | PDF file to analyze |
| `question` | String | Yes | - | Question to answer about the PDF |
| `max_iterations` | Integer | No | 20 | Maximum iterations for the agent |
| `model` | String | No | `gpt-4o-mini` | OpenAI model to use |
| `parse_formula` | Boolean | No | true | Parse mathematical formulas |
| `parse_table` | Boolean | No | true | Parse tables |
| `parse_ocr` | Boolean | No | true | Use OCR for scanned PDFs |

## Response

Server-Sent Events (SSE) stream with the following event types:

### Event Types

#### `status`
Processing status updates

```json
{
  "stage": "pdf_parsing" | "pdf_parsed" | "starting" | "exploring" | "exploration_complete",
  "message": "Description of current stage",
  "documentLength": 12345  // Optional: document size in characters
}
```

#### `answer`
Final answer from the agent

```json
{
  "answer": "The detailed answer to your question...",
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "total_tokens": 1801
  }
}
```

#### `metadata`
Processing metadata and statistics

```json
{
  "processing_time_ms": 15234,
  "stats": {
    "tool_calls": 12,
    "content_reads": 8,
    "figure_analyses": 2,
    "search_iterations": 10
  }
}
```

#### `complete`
Processing completed successfully

```json
{
  "message": "Agentic reading completed successfully"
}
```

#### `error`
Error occurred during processing

```json
{
  "message": "Error description"
}
```

## Usage Examples

### cURL

```bash
curl -X POST http://localhost:8081/pdf_question_stream \
  -F "file=@paper.pdf" \
  -F "question=What is the main contribution of this paper?" \
  -F "max_iterations=20" \
  -F "model=gpt-4o-mini" \
  -N
```

### Using the Test Script

```bash
./test_pdf_question.sh paper.pdf "What is the main contribution of this paper?"
```

### JavaScript/TypeScript

```typescript
const formData = new FormData();
formData.append('file', pdfFile);
formData.append('question', 'What is the main contribution?');
formData.append('max_iterations', '20');
formData.append('model', 'gpt-4o-mini');

const eventSource = new EventSource(
  'http://localhost:8081/pdf_question_stream',
  {
    method: 'POST',
    body: formData
  }
);

eventSource.addEventListener('status', (event) => {
  const data = JSON.parse(event.data);
  console.log('Status:', data.message);
});

eventSource.addEventListener('answer', (event) => {
  const data = JSON.parse(event.data);
  console.log('Answer:', data.answer);
});

eventSource.addEventListener('complete', () => {
  console.log('Processing complete');
  eventSource.close();
});

eventSource.addEventListener('error', (event) => {
  const data = JSON.parse(event.data);
  console.error('Error:', data.message);
  eventSource.close();
});
```

### Python

```python
import requests

files = {'file': open('paper.pdf', 'rb')}
data = {
    'question': 'What is the main contribution of this paper?',
    'max_iterations': '20',
    'model': 'gpt-4o-mini'
}

response = requests.post(
    'http://localhost:8081/pdf_question_stream',
    files=files,
    data=data,
    stream=True
)

for line in response.iter_lines():
    if line:
        line = line.decode('utf-8')
        if line.startswith('data: '):
            print(line[6:])
```

## How It Works

1. **PDF Upload**: Client uploads a PDF file with a question
2. **PDF Parsing**: MinerU parses the PDF into markdown format
   - Extracts text, formulas, tables, and images
   - Images are uploaded to MinIO storage
   - Results are cached in MongoDB
3. **Document Preview**: Creates a hierarchical summary of the document
4. **Agentic Exploration**: AI agent explores the document using tools:
   - `readContent`: Read specific sections by position
   - `searchContent`: Search for specific text
   - `readFigure`: Analyze images using vision AI
   - `updateMemo`: Keep track of findings
5. **Answer Generation**: Agent synthesizes findings into a comprehensive answer
6. **Streaming Response**: Real-time updates sent to client via SSE

## Environment Variables

Required environment variables (see `.env.example`):

```bash
# MinerU API
MINERU_API_URL=https://minerudeployment-production.up.railway.app

# MongoDB for caching
MONGO_URL=mongodb://localhost:27017

# MinIO for image storage
MINIO_PUBLIC_HOST=https://storage.treer.ai/
MINIO_ENDPOINT=storage.treer.ai
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=your_access_key
MINIO_SECRET_KEY=your_secret_key

# OpenAI API
OPENAI_API_KEY=your_openai_api_key
```

## Error Handling

The endpoint handles various error scenarios:

- **No file provided**: Returns 400 with error message
- **Invalid file type**: Rejects non-PDF files
- **File too large**: Rejects files over 50MB
- **No question provided**: Returns 400 with error message
- **Parsing errors**: Streams error event with details
- **Agent errors**: Streams error event with details

## Performance Considerations

- **Caching**: Parsed PDFs are cached in MongoDB to avoid re-parsing
- **File Cleanup**: Uploaded files are automatically deleted after processing
- **Context Management**: Agent automatically manages context to avoid token limits
- **Parallel Processing**: Image uploads happen in parallel for efficiency

## Limitations

- Maximum file size: 50MB
- Maximum iterations: Configurable (default 20)
- Supported format: PDF only
- Requires internet connection for MinerU API and OpenAI API
