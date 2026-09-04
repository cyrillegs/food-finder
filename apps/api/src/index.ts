import 'dotenv/config';
import { app } from './shared/app';

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => {
  console.log(`Food Finder API listening on http://localhost:${PORT}`);
});
