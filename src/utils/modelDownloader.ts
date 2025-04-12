import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import extract from 'extract-zip';
import { createWriteStream } from 'fs';

export class ModelDownloader {
  private readonly modelsDir: string;
  private readonly pinataGateway: string;
  private readonly pinataApiKey: string;
  private readonly pinataApiSecret: string;

  constructor() {
    this.modelsDir = path.join(process.cwd(), 'models');
    // Pinata 게이트웨이 URL과 API 키 설정
    this.pinataGateway = 'https://gateway.pinata.cloud/ipfs';
    this.pinataApiKey = process.env.PINATA_API_KEY || '';
    this.pinataApiSecret = process.env.PINATA_API_SECRET || '';
  }

  async downloadModelFromIPFS(cid: string): Promise<string> {
    const modelPath = path.join(this.modelsDir, cid);

    try {
      // 이미 다운로드된 모델인지 확인
      try {
        await fs.access(modelPath);
        console.log('Model already exists locally:', cid);
        return modelPath;
      } catch {
        // 모델이 없으면 계속 진행
      }

      // 디렉토리 생성
      await fs.mkdir(modelPath, { recursive: true });

      // Pinata API를 통해 파일 다운로드
      console.log('Downloading model from IPFS:', cid);
      const response = await axios({
        method: 'get',
        url: `${this.pinataGateway}/${cid}`,
        headers: {
          'pinata_api_key': this.pinataApiKey,
          'pinata_secret_api_key': this.pinataApiSecret
        },
        responseType: 'stream'
      });

      // 파일 저장
      const zipPath = path.join(modelPath, 'model.zip');
      const writer = createWriteStream(zipPath);
      
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // ZIP 파일 압축 해제
      console.log('Extracting model files...');
      await extract(zipPath, { dir: modelPath });

      // 압축 파일 삭제
      await fs.unlink(zipPath);

      console.log('Model downloaded and extracted successfully:', cid);
      return modelPath;
    } catch (error) {
      console.error('Error downloading model from IPFS:', error);
      throw new Error(`Failed to download model: ${cid}`);
    }
  }

  // 모델 파일 유효성 검사
  async validateModelFiles(modelPath: string): Promise<boolean> {
    try {
      const requiredFiles = [
        'pytorch_lora_weights.safetensors',
        'config.json'
      ];

      for (const file of requiredFiles) {
        const filePath = path.join(modelPath, file);
        await fs.access(filePath);
      }

      return true;
    } catch {
      return false;
    }
  }

  // 캐시된 모델 정리
  async cleanupOldModels(maxAge: number = 7 * 24 * 60 * 60 * 1000) { // 기본 7일
    try {
      const models = await fs.readdir(this.modelsDir);
      
      for (const model of models) {
        const modelPath = path.join(this.modelsDir, model);
        const stats = await fs.stat(modelPath);
        
        const age = Date.now() - stats.mtime.getTime();
        if (age > maxAge) {
          console.log('Removing old model:', model);
          await fs.rm(modelPath, { recursive: true });
        }
      }
    } catch (error) {
      console.error('Error cleaning up old models:', error);
    }
  }
}

// 싱글톤 인스턴스 생성
export const modelDownloader = new ModelDownloader(); 