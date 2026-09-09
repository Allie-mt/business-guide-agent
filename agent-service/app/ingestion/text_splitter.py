from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document


def split_documents(
    documents: list[Document],
    chunk_size: int = 500,
    chunk_overlap: int = 50,
) -> list[Document]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", "。", "；", "，", " ", ""],
        length_function=len,
    )

    chunks = splitter.split_documents(documents)

    for i, chunk in enumerate(chunks):
        chunk.metadata["chunk_index"] = i

    return chunks