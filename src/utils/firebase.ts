import { db } from '../config/firebase';

// 인터페이스 정의
interface ImageData {
  cid: string;
  fileName: string;
  mimeType: string;
  size: number;
  creatorAddress: string;
  metadata: {
    fileName: string;
    mimeType: string;
    size: number;
    timestamp: string;
  };
  createdAt: string;
  tokenId?: string;
  mintedAt?: string;
  ipId?: string;
}

interface ImageEntry {
  id: string;
  data: ImageData;
}

export const firebaseDB = {
  // 데이터 읽기
  async get(path: string) {
    const snapshot = await db.ref(path).once('value');
    return snapshot.val();
  },

  // 데이터 쓰기
  async set(path: string, data: any) {
    await db.ref(path).set(data);
    return data;
  },

  // 데이터 업데이트
  async update(path: string, data: any) {
    await db.ref(path).update(data);
    return data;
  },

  // 데이터 삭제
  async remove(path: string) {
    await db.ref(path).remove();
  },

  // 리스너 등록
  onValue(path: string, callback: (data: any) => void) {
    return db.ref(path).on('value', (snapshot) => {
      callback(snapshot.val());
    });
  },

  // 새로운 함수들 추가
  async findImageByCID(cid: string, walletAddress: string) {
    try {
      const imagesRef = db.ref('images');
      const snapshot = await imagesRef.once('value');
      const images = snapshot.val();
      
      if (!images) {
        return null;
      }
      
      for (const id in images) {
        const image = images[id];
        if (image.cid === cid && image.creatorAddress === walletAddress) {
          return { ...image, id };
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  },

  async updateNFTInfo(imageId: string, nftInfo: { tokenId: string, mintedAt: string, ipId?: string }) {
    try {
      const updateData: any = {
        tokenId: nftInfo.tokenId,
        mintedAt: nftInfo.mintedAt
      };
      
      if (nftInfo.ipId) {
        updateData.ipId = nftInfo.ipId;
      }
      
      await db.ref(`images/${imageId}`).update(updateData);
      return true;
    } catch (error) {
      return false;
    }
  },

  async getUserImages(address: string) {
    try {
      const snapshot = await db.ref('images').once('value');
      const images = snapshot.val();
      
      if (!images) return [];

      return Object.entries(images)
        .filter(([_, image]: [string, any]) => image.creatorAddress === address)
        .map(([id, image]: [string, any]) => ({
          id,
          ...image
        }))
        .sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    } catch (error) {
      throw error;
    }
  },

  // NFT 정보 업데이트 함수 수정
  async updateImageData(imageId: string, updateData: any) {
    try {
      await db.ref(`images/${imageId}`).update(updateData);
      return true;
    } catch (error) {
      return false;
    }
  },

  // 이미지 삭제 함수
  async deleteImage(imageId: string) {
    try {
      await db.ref(`images/${imageId}`).remove();
      
      return true;
    } catch (error) {
      return false;
    }
  }
}; 