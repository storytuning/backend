import argparse
import json
import sys
import torch
from diffusers import StableDiffusionPipeline
from safetensors.torch import load_file
import base64
from io import BytesIO

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model_path', type=str, required=True)
    parser.add_argument('--prompt', type=str, required=True)
    args = parser.parse_args()

    try:
        # Load base model
        pipe = StableDiffusionPipeline.from_pretrained(
            "runwayml/stable-diffusion-v1-5",
            torch_dtype=torch.float32
        )

        # Load LoRA weights
        lora_path = f"{args.model_path}/model/pytorch_lora_weights.safetensors"
        state_dict = load_file(lora_path)
        pipe.unet.load_state_dict(state_dict, strict=False)

        # Generate image
        image = pipe(
            args.prompt,
            num_inference_steps=30,
            guidance_scale=7.5
        ).images[0]

        # Convert image to base64
        buffered = BytesIO()
        image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()

        # Return result as JSON
        result = {
            "imageData": img_str
        }
        print(json.dumps(result))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main() 