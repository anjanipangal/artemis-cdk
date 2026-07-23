from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import boto3
from livekit.api import LiveKitAPI
from livekit.api.twirp_client import TwirpError
from livekit.protocol.sip import (
    CreateSIPOutboundTrunkRequest,
    DeleteSIPTrunkRequest,
    ListSIPOutboundTrunkRequest,
    SIPOutboundTrunkInfo,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

secrets_client = boto3.client("secretsmanager")


def _get_secret_json(secret_arn: str) -> dict[str, str]:
    return json.loads(
        secrets_client.get_secret_value(SecretId=secret_arn)["SecretString"]
    )


def _build_api_client() -> LiveKitAPI:
    secret = _get_secret_json(os.environ["LIVEKIT_SECRET_ARN"])
    return LiveKitAPI(
        url=os.environ["LIVEKIT_URL"],
        api_key=secret["api_key"],
        api_secret=secret["api_secret"],
    )


def _get_twilio_credentials(secret_arn: str) -> dict[str, str]:
    return _get_secret_json(secret_arn)


class OutboundTrunkManager:
    """Manages LiveKit SIP outbound trunk lifecycle."""

    def __init__(
        self,
        *,
        trunk_name: str,
        address: str,
        numbers: list[str],
        auth_username: str,
        auth_password: str,
    ) -> None:
        self._trunk_name = trunk_name
        self._address = address
        self._numbers = numbers
        self._auth_username = auth_username
        self._auth_password = auth_password

    async def create(self) -> dict[str, str]:
        api = _build_api_client()
        try:
            trunk = await self._find_or_create_trunk(api)
            return {"trunk_id": trunk.sip_trunk_id}
        finally:
            await api.aclose()

    async def _find_or_create_trunk(self, api: LiveKitAPI) -> SIPOutboundTrunkInfo:
        response = await api.sip.list_outbound_trunk(ListSIPOutboundTrunkRequest())
        for trunk in response.items:
            if trunk.name == self._trunk_name:
                logger.info(f"Found existing trunk {trunk.name} ({trunk.sip_trunk_id})")
                return trunk
        trunk = await api.sip.create_outbound_trunk(
            CreateSIPOutboundTrunkRequest(
                trunk=SIPOutboundTrunkInfo(
                    name=self._trunk_name,
                    address=self._address,
                    numbers=self._numbers,
                    auth_username=self._auth_username,
                    auth_password=self._auth_password,
                )
            )
        )
        logger.info(f"Created outbound trunk {trunk.sip_trunk_id}")
        return trunk


def _parse_resource_ids(physical_resource_id: str | None) -> dict[str, str]:
    try:
        return json.loads(physical_resource_id or "")
    except (json.JSONDecodeError, TypeError):
        logger.warning(f"Cannot parse physical_resource_id: {physical_resource_id}")
        return {}


async def _delete_trunk(resource_ids: dict[str, str]) -> None:
    if not (trunk_id := resource_ids.get("trunk_id")):
        return
    api = _build_api_client()
    try:
        await api.sip.delete_trunk(
            DeleteSIPTrunkRequest(sip_trunk_id=trunk_id)
        )
        logger.info(f"Deleted trunk {trunk_id}")
    except TwirpError as e:
        if e.code == "not_found":
            logger.info(f"Trunk {trunk_id} already deleted, skipping")
        else:
            raise
    finally:
        await api.aclose()


async def _on_event(event: dict[str, Any]) -> dict[str, Any]:
    request_type = event["RequestType"]

    if request_type == "Delete":
        resource_ids = _parse_resource_ids(event.get("PhysicalResourceId"))
        await _delete_trunk(resource_ids)
        return {"PhysicalResourceId": event.get("PhysicalResourceId", "deleted")}

    props = event["ResourceProperties"]

    # Resolve Twilio credentials from Secrets Manager
    twilio_creds = _get_twilio_credentials(props["twilio_credentials_secret_arn"])

    manager = OutboundTrunkManager(
        trunk_name=props["trunk_name"],
        address=props["address"],
        numbers=json.loads(props["numbers"]),
        auth_username=twilio_creds["username"],
        auth_password=twilio_creds["password"],
    )

    if request_type == "Update":
        resource_ids = _parse_resource_ids(event.get("PhysicalResourceId"))
        await _delete_trunk(resource_ids)

    ids = await manager.create()
    physical_id = json.dumps(ids)
    return {
        "PhysicalResourceId": physical_id,
        "Data": {"TrunkId": ids["trunk_id"]},
    }


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    return asyncio.run(_on_event(event))
