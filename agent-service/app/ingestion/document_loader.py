from pathlib import Path

from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_core.documents import Document


SUPPORTED_EXTENSIONS = {
    ".pdf": PyPDFLoader,
    ".txt": TextLoader,
    ".md": TextLoader,
}


async def load_document(file_path: str) -> list[Document]:
    path = Path(file_path)
    ext = path.suffix.lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"不支持的文件格式: {ext}，支持格式: {list(SUPPORTED_EXTENSIONS.keys())}")

    loader_cls = SUPPORTED_EXTENSIONS[ext]

    if ext == ".pdf":
        loader = loader_cls(file_path)
    else:
        loader = loader_cls(file_path, encoding="utf-8")

    documents = await loader.aload()
    for doc in documents:
        doc.metadata["source"] = str(path.name)

    return documents