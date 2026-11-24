"""產生無真實人物或公司資訊的示意圖，並透過 API 建立照片情境。"""

import hashlib
import io
import json
import sys
import uuid
from pathlib import Path

from PIL import Image, ImageDraw


def synthetic_photo(index: int = 0) -> bytes:
    """繪製 DEMO 管線與閥件，避免把真實現場資料帶入示範環境。"""
    image = Image.new("RGB", (1200, 800), (190, 202, 208))
    draw = ImageDraw.Draw(image)
    for x in range(0, 1200, 100):
        draw.line((x, 0, x, 800), fill=(155, 170, 180), width=2)
    for y in range(0, 800, 100):
        draw.line((0, y, 1200, y), fill=(155, 170, 180), width=2)
    draw.rectangle((80, 300, 1120, 410), fill=(44, 99, 130))
    draw.rectangle((540, 150, 650, 650), fill=(44, 99, 130))
    draw.ellipse((490, 250, 700, 460), fill=(183, 59, 48))
    draw.line((510, 355, 680, 355), fill="white", width=14)
    draw.rectangle((40, 40, 470, 130), fill="white")
    draw.text(
        (60, 60),
        f"DEMO - VALVE {index + 1:02d}",
        fill=(20, 30, 40),
        font_size=34,
    )
    output = io.BytesIO()
    image.save(output, "JPEG", quality=90)
    return output.getvalue()


def upload_photo(api, task_id: str, item: dict, index: int) -> dict:
    """以正式上傳端點產生兩版照片；不直接寫資料庫或儲存。"""
    image = synthetic_photo(index)
    boundary = f"demo-{uuid.uuid4()}"
    fields = {
        "sha256": hashlib.sha256(image).hexdigest(),
        "item_id": item["item_id"],
        "is_overview": "false",
        "capture_source": "library",
        "caption": ["DEMO 已做內業編修", "DEMO 尚未內業編修"][index],
        "layer": json.dumps({"enabled": True, "corner": "bottom_right"}),
    }
    parts = []
    values = list(fields.items()) + [
        ("point_ids", point["id"]) for point in item["points"]
    ]
    for name, value in values:
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; "
            f'name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
        'filename="demo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode()
        + image
        + f"\r\n--{boundary}--\r\n".encode()
    )
    return api.send(
        "POST",
        f"/inspection-tasks/{task_id}/photos",
        b"".join(parts),
        {
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Idempotency-Key": str(uuid.uuid4()),
        },
        (201,),
    )


def seed_photos(sessions: dict, tasks: dict) -> dict:
    """預建兩張照片並保留零照片任務，作為下次試用的起點。"""
    field = sessions["field_a"]
    task_id = tasks["B_in_progress"]
    coverage = field.call("GET", f"/field/inspection-tasks/{task_id}/evidence")
    photos = [
        upload_photo(field, task_id, coverage["items"][0], index)
        for index in range(2)
    ]
    photo = photos[0]
    edited = sessions["office"].call(
        "PUT",
        f"/inspection-tasks/{task_id}/photos/{photo['id']}/office-version",
        {"rotation": 90, "brightness": 15},
    )
    before = photo["variants"]
    after = edited["variants"]
    if after["field"]["sha256"] != before["field"]["sha256"]:
        raise RuntimeError("內業編修不得修改現場版")
    if after["office"]["sha256"] == before["office"]["sha256"]:
        raise RuntimeError("示範內業版必須有實際編修")
    visible = field.call("GET", f"/field/inspection-tasks/{task_id}/photos")[
        "items"
    ]
    clean_task = tasks["A_a_pending"]
    clean = field.call("GET", f"/field/inspection-tasks/{clean_task}/photos")[
        "items"
    ]
    if len(visible) != 2 or clean:
        raise RuntimeError("示範必須有兩張有效照片與零照片乾淨任務")
    return {
        "task_id": task_id,
        "edited": photo["id"],
        "unedited": photos[1]["id"],
        "clean_task_id": clean_task,
        "count": len(photos),
    }


if __name__ == "__main__":
    Path(sys.argv[1]).write_bytes(synthetic_photo())
