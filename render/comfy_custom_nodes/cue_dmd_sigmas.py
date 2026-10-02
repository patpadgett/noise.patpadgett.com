# CUE custom node for ComfyUI: the fixed 4-point sigma schedule a DMD / Self-Forcing distilled Wan checkpoint was
# trained for (t = 1000, 750, 500, 250 → 0), as a SIGMAS output for SamplerCustomAdvanced.
# ModelSamplingSD3(shift) rescales sigma as  s' = shift*s / (1 + (shift-1)*s); the model is sampled on that schedule.
import torch

class CueDMDSigmas:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "shift": ("FLOAT", {"default": 5.0, "min": 0.0, "max": 20.0, "step": 0.1}),
            "steps": ("STRING", {"default": "1000,750,500,250"}),
        }}
    RETURN_TYPES = ("SIGMAS",)
    FUNCTION = "get"
    CATEGORY = "sampling/custom_sampling/schedulers"
    def get(self, shift, steps):
        ts = [float(x) / 1000.0 for x in steps.split(",") if x.strip()]
        sig = [(shift * s) / (1 + (shift - 1) * s) if shift else s for s in ts] + [0.0]
        return (torch.tensor(sig, dtype=torch.float32),)

NODE_CLASS_MAPPINGS = {"CueDMDSigmas": CueDMDSigmas}
NODE_DISPLAY_NAME_MAPPINGS = {"CueDMDSigmas": "CUE · DMD sigmas (1000/750/500/250)"}
