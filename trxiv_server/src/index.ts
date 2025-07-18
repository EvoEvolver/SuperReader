import express from 'express';
import axios from 'axios';

const app = express();
const port = 7777;

app.use(express.json());

const handleSubmit = async (req: express.Request, res: express.Response) => {
  const arxivId = req.params.id;
  const type = req.path.split('/')[1];
  let arxivUrl: string;
  arxivUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
  try {
    const response = await axios.post('http://localhost:8080/submit/pdf_to_tree', {
      file_url: arxivUrl,
    })
    const resData = response.data
    const job_id = resData["job_id"]
    // redirect to worker.treer.ai/wait?job_id=...
    res.redirect(`https://worker.treer.ai/wait?job_id=${job_id}`)
  } catch (error) {
    res.status(500).send({ error: 'Failed to submit to pdf_to_tree service' });
  }
};

app.get('/abs/:id', handleSubmit);
app.get('/pdf/:id', handleSubmit);
app.get('/html/:id', handleSubmit);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
