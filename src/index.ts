import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import pinataSDK from "@pinata/sdk";
import path from "path";
import { Readable } from "stream";
import { firebaseDB } from "./utils/firebase";
import { db } from "./config/firebase";
import { modelDownloader } from './utils/modelDownloader';
import { ModelInference } from './utils/modelInference';

// 인터페이스 추가
interface ModelData {
  modelName: string;
  walletAddress: string;
  description?: string;
  status: string;
  selectedCids: string[];
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}

interface GeneratedImage {
  cid: string;
  prompt: string;
  url: string;
  modelName: string;
  modelOwner: string;
  createdAt: string;
}

// 환경변수 로드 확인
console.log("환경변수 확인:", {
  firebaseUrl: process.env.FIREBASE_DATABASE_URL ? "설정됨" : "미설정",
  pinataKey: process.env.PINATA_API_KEY ? "설정됨" : "미설정",
  pinataSecret: process.env.PINATA_API_SECRET ? "설정됨" : "미설정",
});

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Pinata 클라이언트 설정
const pinata = new pinataSDK(
  process.env.PINATA_API_KEY ?? "",
  process.env.PINATA_API_SECRET ?? ""
);

// API 키 검증
pinata
  .testAuthentication()
  .then(() => {
    console.log("Pinata 연결 성공!");
  })
  .catch((err) => {
    console.error("Pinata 연결 실패:", err);
  });

app.use(cors());
app.use(express.json());

// 이미지 업로드 엔드포인트
app.post("/api/upload", upload.array("images"), async (req, res) => {
  try {
    if (!req.files || !Array.isArray(req.files)) {
      return res.status(400).json({ error: "파일이 없습니다." });
    }

    const creatorAddress = req.body.creatorAddress;
    if (!creatorAddress) {
      return res.status(400).json({ error: "생성자 주소가 필요합니다." });
    }

    // 사용자 확인 또는 생성
    const userRef = `users/${creatorAddress}`;
    let user = await firebaseDB.get(userRef);

    if (!user) {
      user = {
        address: creatorAddress,
        createdAt: new Date().toISOString(),
      };
      await firebaseDB.set(userRef, user);
    }

    const uploadResults = await Promise.all(
      req.files.map(async (file) => {
        try {
          const readableStream = Readable.from(file.buffer);
          const safeFileName = encodeURIComponent(file.originalname);

          const options = {
            pinataMetadata: {
              name: safeFileName,
            },
          };

          const result = await pinata.pinFileToIPFS(readableStream, options);
          const cid = result.IpfsHash;

          // 중복 확인
          const existingImage = await firebaseDB.findImageByCID(
            cid,
            creatorAddress
          );
          if (existingImage) {
            return {
              duplicated: true,
              fileName: safeFileName,
              originalName: file.originalname,
              cid,
            };
          }

          const metadata = {
            fileName: safeFileName,
            mimeType: file.mimetype,
            size: file.size,
            timestamp: new Date().toISOString(),
          };

          const imageId = Date.now().toString();
          const imageData = {
            cid,
            fileName: safeFileName,
            mimeType: file.mimetype,
            size: file.size,
            creatorAddress: creatorAddress,
            metadata,
            createdAt: new Date().toISOString(),
          };

          await firebaseDB.set(`images/${imageId}`, imageData);

          return {
            duplicated: false,
            cid,
            fileName: safeFileName,
            size: file.size,
            ipfsUrl: `https://gateway.pinata.cloud/ipfs/${cid}`,
          };
        } catch (error) {
          console.error("File upload failed:", error);
          return {
            error: true,
            fileName: file.originalname,
            message: "업로드 실패",
          };
        }
      })
    );

    // 결과 반환
    res.json({
      success: true,
      data: uploadResults,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "업로드 실패" });
  }
});

// NFT 민팅 성공 후 Firebase에 tokenId 업데이트
app.post("/api/update-nft-info", async (req, res) => {
  try {
    const { cid, tokenId, walletAddress, ipId } = req.body;

    // 이미지 찾기
    const image = await firebaseDB.findImageByCID(cid, walletAddress);

    // 업데이트할 데이터 준비
    const updateData: any = {
      updatedAt: new Date().toISOString(),
    };

    // tokenId가 있으면 추가
    if (tokenId) {
      updateData.tokenId = tokenId;
      updateData.mintedAt = new Date().toISOString();
    }

    // ipId가 있으면 추가
    if (ipId) {
      updateData.ipId = ipId;
    }

    // NFT 정보 업데이트
    const updated = await firebaseDB.updateImageData(image.id, updateData);

    if (!updated) {
      return res
        .status(500)
        .json({ error: "Failed to update NFT information" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("NFT info update failed:", error);
    res.status(500).json({ error: "Server error occurred" });
  }
});

// 이미지 목록 조회 엔드포인트
app.get("/api/images/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const userImages = await firebaseDB.getUserImages(address);
    res.json(userImages);
  } catch (error) {
    console.error("이미지 조회 실패:", error);
    res.status(500).json({ error: "이미지 조회 실패" });
  }
});

// 파인튜닝 요청 처리 API 엔드포인트 추가
app.post("/api/fine-tune-dataset", async (req, res) => {
  try {
    const { walletAddress, modelName, description, selectedCids, selectedIpIds } = req.body;

    if (!walletAddress || !modelName || !selectedCids || !selectedCids.length || !selectedIpIds || !selectedIpIds.length) {
      return res.status(400).json({ error: "필수 정보가 누락되었습니다." });
    }

    // Firebase에 파인튜닝 요청 정보 저장
    const fineTuneId = Date.now().toString();
    const fineTuneData = {
      walletAddress,
      modelName,
      description: description || "",
      selectedCids,
      selectedIpIds,
      status: "pending", // pending, processing, completed, failed
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 'fine-tune/{walletAddress}/{modelName}'에 저장
    await firebaseDB.set(
      `fine-tune/${walletAddress}/${modelName}`,
      fineTuneData
    );

    // TODO: 실제 환경에서는 Google Cloud Run이나 다른 서비스를 통해 학습 스크립트 실행
    // 예: const jobRef = await submitTrainingJob(walletAddress, modelName);

    res.json({
      success: true,
      message: "파인튜닝 요청이 접수되었습니다",
      data: {
        fineTuneId,
        modelName,
        status: "pending",
      },
    });
  } catch (error) {
    console.error("파인튜닝 요청 실패:", error);
    res
      .status(500)
      .json({ error: "파인튜닝 요청 처리 중 오류가 발생했습니다" });
  }
});

// 파인튜닝 상태 확인 API
app.get("/api/fine-tune-status/:walletAddress/:modelName", async (req, res) => {
  try {
    const { walletAddress, modelName } = req.params;

    const fineTuneData = await firebaseDB.get(
      `fine-tune/${walletAddress}/${modelName}`
    );

    if (!fineTuneData) {
      return res
        .status(404)
        .json({ error: "해당 파인튜닝 요청을 찾을 수 없습니다." });
    }

    res.json({
      success: true,
      data: fineTuneData,
    });
  } catch (error) {
    console.error("파인튜닝 상태 조회 실패:", error);
    res.status(500).json({ error: "상태 조회 중 오류가 발생했습니다" });
  }
});

// 사용자의 모든 파인튜닝 모델 리스트 조회 API
app.get("/api/models/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    // Firebase에서 해당 사용자의 모든 모델 조회
    const userModelsRef = `fine-tune/${walletAddress}`;
    const userModels = await firebaseDB.get(userModelsRef);

    if (!userModels) {
      return res.json({ success: true, data: [] });
    }

    // 모델 데이터를 배열로 변환하여 반환
    const modelsList: ModelData[] = Object.entries(
      userModels as Record<string, any>
    ).map(
      ([modelName, modelData]) =>
        ({
          modelName,
          walletAddress,
          ...(modelData as object),
        } as ModelData)
    );

    // 최신 모델이 먼저 오도록 정렬
    modelsList.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.json({
      success: true,
      data: modelsList,
    });
  } catch (error) {
    console.error("모델 조회 실패:", error);
    res.status(500).json({ error: "모델 목록 조회 중 오류가 발생했습니다" });
  }
});

// 모든 파인튜닝 모델 리스트 조회 API
app.get("/api/models", async (req, res) => {
  try {
    // Firebase에서 모든 사용자의 모델 조회
    const allModelsRef = `fine-tune`;
    const allModels = await firebaseDB.get(allModelsRef);

    if (!allModels) {
      return res.json({ success: true, data: [] });
    }

    // 모든 사용자의 모든 모델을 평면화하여 배열로 변환
    const modelsList: ModelData[] = [];

    Object.entries(allModels as Record<string, any>).forEach(
      ([walletAddress, userModels]) => {
        if (userModels && typeof userModels === "object") {
          Object.entries(userModels as Record<string, any>).forEach(
            ([modelName, modelData]) => {
              modelsList.push({
                modelName,
                walletAddress,
                ...(modelData as object),
              } as ModelData);
            }
          );
        }
      }
    );

    // 최신 모델이 먼저 오도록 정렬
    modelsList.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.json({
      success: true,
      data: modelsList,
    });
  } catch (error) {
    console.error("모델 조회 실패:", error);
    res.status(500).json({ error: "모델 목록 조회 중 오류가 발생했습니다" });
  }
});

// 모델을 사용한 이미지 생성 API
app.post("/api/generate-image", async (req, res) => {
  try {
    const {
      modelName,
      walletAddress,
      prompt,
      modelOwnerAddress,
      numOfImages = 1,
    } = req.body;

    if (!modelName || !walletAddress || !prompt) {
      return res
        .status(400)
        .json({ error: "Model name, wallet address, and prompt are required." });
    }

    // Check model existence and status
    const modelOwner = modelOwnerAddress || walletAddress;
    const modelDataPath = `fine-tune/${modelOwner}/${modelName}`;
    const modelData = await firebaseDB.get(modelDataPath);

    if (!modelData) {
      return res.status(404).json({ error: "Model not found" });
    }

    if (modelData.status !== "completed") {
      return res
        .status(400)
        .json({ error: "Model training is not completed" });
    }

    // Download and prepare model
    const modelPath = await modelDownloader.downloadModelFromIPFS(modelData.modelCid);

    // Initialize inference engine
    const inference = new ModelInference(modelPath);
    
    // Generate images with explicit type
    const generatedImages: GeneratedImage[] = [];
    
    for (let i = 0; i < numOfImages; i++) {
      const result = await inference.generateImage(prompt);
      
      // Upload generated image to IPFS
      const imageStream = Buffer.from(result.imageData, 'base64');
      const options = {
        pinataMetadata: {
          name: `${modelName}_generated_${Date.now()}_${i}`,
        },
      };

      const pinataResult = await pinata.pinFileToIPFS(imageStream, options);
      const imageCid = pinataResult.IpfsHash;

      generatedImages.push({
        cid: imageCid,
        prompt,
        url: `https://gateway.pinata.cloud/ipfs/${imageCid}`,
        modelName,
        modelOwner,
        createdAt: new Date().toISOString(),
      });
    }

    // Save usage record
    const usageId = Date.now().toString();
    const usageData = {
      modelName,
      modelOwner,
      userAddress: walletAddress,
      prompt,
      numOfImages,
      images: generatedImages,
      timestamp: new Date().toISOString(),
    };

    await firebaseDB.set(`model-usage/${usageId}`, usageData);

    res.json({
      success: true,
      message: "Images generated successfully",
      data: {
        images: generatedImages,
        usageId,
      },
    });
  } catch (error) {
    console.error("Image generation failed:", error);
    res.status(500).json({ error: "Failed to generate images" });
  }
});

// 생성된 이미지 목록 조회 API
app.get("/api/generated-images/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    // Firebase에서 사용자가 생성한 이미지 조회
    const usageRef = "model-usage";
    const allUsages = await firebaseDB.get(usageRef);

    if (!allUsages) {
      return res.json({ success: true, data: [] });
    }

    // 해당 사용자의 모델 사용 기록만 필터링
    const userImages: GeneratedImage[] = [];

    Object.entries(allUsages).forEach(([usageId, usageData]: [string, any]) => {
      if (usageData.userAddress === walletAddress) {
        // 실제 구현에서는 여기서 생성된 이미지 정보를 별도 테이블에서 조회
        // 현재는 목업 데이터를 반환

        // 각 사용에 대해 생성된 이미지 데이터 구성
        const mockImage: GeneratedImage = {
          cid: `mock_${usageId}`,
          prompt: usageData.prompt,
          url: `https://gateway.pinata.cloud/ipfs/mock_${usageId}`,
          modelName: usageData.modelName,
          modelOwner: usageData.modelOwner,
          createdAt: usageData.timestamp,
        };

        userImages.push(mockImage);
      }
    });

    // 최신 생성 이미지가 먼저 오도록 정렬
    userImages.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.json({
      success: true,
      data: userImages,
    });
  } catch (error) {
    console.error("생성 이미지 조회 실패:", error);
    res
      .status(500)
      .json({ error: "생성 이미지 목록 조회 중 오류가 발생했습니다" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
