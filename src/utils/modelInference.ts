import { spawn } from 'child_process';
import path from 'path';

export class ModelInference {
  private readonly modelPath: string;

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  async generateImage(prompt: string): Promise<{ imageData: string }> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(__dirname, '../../scripts/inference.py');
      
      const process = spawn('python3', [
        pythonScript,
        '--model_path', this.modelPath,
        '--prompt', prompt
      ]);

      let outputData = '';
      let errorData = '';

      process.stdout.on('data', (data) => {
        outputData += data.toString();
      });

      process.stderr.on('data', (data) => {
        errorData += data.toString();
      });

      process.on('close', (code) => {
        if (code !== 0) {
          console.error('Inference error:', errorData);
          reject(new Error('Image generation failed'));
          return;
        }

        try {
          const result = JSON.parse(outputData);
          resolve(result);
        } catch (error) {
          reject(new Error('Failed to parse inference result'));
        }
      });
    });
  }
} 