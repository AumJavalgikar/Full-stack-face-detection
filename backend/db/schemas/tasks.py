from pydantic import BaseModel, HttpUrl


class SubmitFeedRequest(BaseModel):
    url: HttpUrl
